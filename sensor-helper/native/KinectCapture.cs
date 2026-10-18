using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Kinect;

namespace ProjectionMapper.Sensor
{
    internal static class KinectCapture
    {
        private static volatile bool stopping;
        private static readonly object statusGate = new object();
        private static readonly object outputGate = new object();
        private static readonly Stream output = Console.OpenStandardOutput();
        private static readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private static readonly DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        private static string currentState = "waiting";
        private static string currentMessage = "No Kinect connected. Waiting for its powered adapter and USB 3 connection.";
        private static double UnixMs() { return (DateTime.UtcNow - epoch).TotalMilliseconds; }
        private static void Status(string state, string message)
        {
            lock (statusGate) {
                currentState = state; currentMessage = message.Length > 500 ? message.Substring(0, 500) : message;
                byte[] packet = System.Text.Encoding.UTF8.GetBytes(json.Serialize(new { protocol = "pm-sensor", version = 1, type = "status", mode = "live", state = currentState, message = currentMessage }));
                try { lock (outputGate) { FrameCodec.WritePacket(output, packet); } }
                catch (IOException) { stopping = true; }
            }
        }
        [STAThread]
        private static int Main()
        {
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { stopping = true; e.Cancel = true; };
            // If the Node parent disappears, its stdin closes even while no camera frames are arriving.
            Thread parent = new Thread(delegate() { try { Console.OpenStandardInput().ReadByte(); } catch (IOException) { } stopping = true; });
            parent.IsBackground = true; parent.Start();
            using (Timer heartbeat = new Timer(delegate { lock (statusGate) { Status(currentState, currentMessage); } }, null, 0, 2000)) {
                try { RunSensor(); return 0; }
                catch (Exception error) { Status("error", "Kinect SDK capture failed: " + error.Message); return 1; }
            }
        }
        private static void RunSensor()
        {
            KinectSensor sensor = null;
            MultiSourceFrameReader reader = null;
            BodyFrameReader bodyReader = null;
            LatestMailbox<byte[]> mailbox = new LatestMailbox<byte[]>();
            Thread writer = new Thread(delegate() {
                try {
                    byte[] packet;
                    while ((packet = mailbox.Take()) != null) { lock (outputGate) { FrameCodec.WritePacket(output, packet); } }
                } catch (IOException) { stopping = true; }
            });
            writer.IsBackground = true; writer.Start();
            try {
                while (!stopping && sensor == null) { sensor = KinectSensor.GetDefault(); if (sensor == null) Thread.Sleep(500); }
                if (stopping) return;
                sensor.Open(); reader = sensor.OpenMultiSourceFrameReader(FrameSourceTypes.Color | FrameSourceTypes.Depth);
                // Optional SDK gravity/floor estimate. Failure must not block registered RGB/XYZ.
                if (Environment.GetEnvironmentVariable("PM_KINECT_FLOOR_PLANE") != "0") {
                    try { bodyReader = sensor.BodyFrameSource.OpenReader(); } catch (Exception) { bodyReader = null; }
                }
                CaptureClock clock = new CaptureClock(); long sequence = 0;
                JavaScriptSerializer frameJson = new JavaScriptSerializer(); // acquisition thread only
                CaptureCadence cadence = new CaptureCadence(5);
                const int colorWidth = 1920, colorHeight = 1080, depthWidth = 512, depthHeight = 424;
                const int count = depthWidth * depthHeight;
                // Reuse SDK/conversion buffers. Only encoded immutable packets enter the mailbox.
                byte[] bgra = new byte[colorWidth * colorHeight * 4], rgb = new byte[count * 3];
                ushort[] pixels = new ushort[count]; float[] xyz = new float[count * 3];
                ColorSpacePoint[] colorPoints = new ColorSpacePoint[count];
                CameraSpacePoint[] cameraPoints = new CameraSpacePoint[count];
                bool hasStreamed = false; Stopwatch noFrames = Stopwatch.StartNew();
                while (!stopping) {
                    if (!sensor.IsAvailable) {
                        if (hasStreamed) { Status("waiting", "Kinect disconnected. Restarting acquisition…"); return; }
                        noFrames.Restart(); Thread.Sleep(100); continue;
                    }
                    if (noFrames.ElapsedMilliseconds > 10000) throw new IOException("Sensor is available but valid paired frames have stalled.");
                    // MultiSourceFrame itself has no IDisposable in the desktop SDK; individual frames/readers do.
                    MultiSourceFrame multi = reader.AcquireLatestFrame();
                    if (multi == null) {
                        if (noFrames.ElapsedMilliseconds > 10000) throw new IOException("Sensor is available but RGB/depth frames have stalled.");
                        Thread.Sleep(5); continue;
                    }
                    using (ColorFrame color = multi.ColorFrameReference.AcquireFrame())
                    using (DepthFrame depth = multi.DepthFrameReference.AcquireFrame()) {
                        if (color == null || depth == null) continue;
                        double receipt = UnixMs();
                        FrameTiming time = clock.Normalize(color.RelativeTime.TotalMilliseconds, depth.RelativeTime.TotalMilliseconds, receipt);
                        if (time == null) continue;
                        noFrames.Restart();
                        if (!cadence.Take(depth.RelativeTime.TotalMilliseconds)) continue;
                        var colorSize = color.FrameDescription; var depthSize = depth.FrameDescription;
                        if (colorSize.Width != 1920 || colorSize.Height != 1080 || depthSize.Width != 512 || depthSize.Height != 424)
                            throw new InvalidDataException("Unexpected Kinect v2 frame dimensions.");
                        color.CopyConvertedFrameDataToArray(bgra, ColorImageFormat.Bgra);
                        depth.CopyFrameDataToArray(pixels);
                        FrameCodec.KeepReliableDepth(pixels, depth.DepthMinReliableDistance, depth.DepthMaxReliableDistance);
                        sensor.CoordinateMapper.MapDepthFrameToColorSpace(pixels, colorPoints);
                        sensor.CoordinateMapper.MapDepthFrameToCameraSpace(pixels, cameraPoints);
                        for (int i = 0; i < count; i++) FrameCodec.RegisterPixel(bgra, colorWidth, colorHeight, pixels, rgb, xyz, i,
                            colorPoints[i].X, colorPoints[i].Y, cameraPoints[i].X, cameraPoints[i].Y, cameraPoints[i].Z);
                        float[] floor = null;
                        if (bodyReader != null) {
                            try {
                                using (BodyFrame body = bodyReader.AcquireLatestFrame()) {
                                    if (body != null) { var p = body.FloorClipPlane;
                                        floor = FrameCodec.NormalizeFloorPlane(p.X, p.Y, p.Z, p.W,
                                            body.RelativeTime.TotalMilliseconds - depth.RelativeTime.TotalMilliseconds); }
                                }
                            } catch (Exception) { bodyReader.Dispose(); bodyReader = null; }
                        }
                        double exposure = color.ColorCameraSettings.ExposureTime.TotalMilliseconds;
                        var metadata = new Dictionary<string, object> {
                            { "device", new { id = sensor.UniqueKinectId, label = "Kinect v2 registered RGB + XYZ", kind = "kinect-v2",
                                color = new { width = depthWidth, height = depthHeight }, depth = new { width = depthWidth, height = depthHeight },
                                colorRegistration = "depth", depthScaleMeters = 0.001, colorIntrinsics = (object)null, depthIntrinsics = (object)null, depthToColor = (object)null } },
                            { "sequence", sequence++ }, { "capturedAtMs", time.CapturedAtMs },
                            { "exposureMs", exposure }, { "clockUncertaintyMs", time.ClockUncertaintyMs },
                            { "cameraPointsFormat", "xyz-f32-le" }
                        };
                        if (floor != null) metadata.Add("floorPlane", floor);
                        if (!hasStreamed) { Status("streaming", "Kinect SDK-registered RGB/depth/XYZ connected at up to 5 processed fps. Floor is optional; projector mapping and physical accuracy still require validation."); hasStreamed = true; }
                        mailbox.Put(FrameCodec.Encode(frameJson.Serialize(metadata), rgb, pixels, xyz));
                    }
                }
            } finally {
                mailbox.Close();
                if (reader != null) reader.Dispose();
                if (bodyReader != null) bodyReader.Dispose();
                if (sensor != null) sensor.Close();
                writer.Join(250);
            }
        }
    }
}
