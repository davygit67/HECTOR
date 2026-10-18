// C# 5 / .NET Framework compatible. Also exercised under .NET 8 on the development Mac.
using System;
using System.IO;
using System.Text;
using System.Threading;

namespace ProjectionMapper.Sensor
{
    public sealed class FrameTiming
    {
        public double CapturedAtMs;
        public double ClockUncertaintyMs;
    }

    public sealed class CaptureClock
    {
        private double offset = double.PositiveInfinity;
        private double lastRelative = -1;
        private double lastCapture = -1;
        public FrameTiming Normalize(double colorMs, double depthMs, double receivedAtMs)
        {
            if (Double.IsNaN(colorMs) || Double.IsInfinity(colorMs) || Double.IsNaN(depthMs) || Double.IsInfinity(depthMs) ||
                Double.IsNaN(receivedAtMs) || Double.IsInfinity(receivedAtMs) || colorMs < 0 || depthMs < 0 || receivedAtMs < 0)
                throw new ArgumentException("Invalid sensor clock.");
            if (Math.Abs(colorMs - depthMs) > 20) return null; // do not pair widely separated exposures
            double relative = (colorMs + depthMs) / 2;
            if (lastRelative >= 0 && relative < lastRelative) throw new InvalidOperationException("Sensor clock restarted.");
            if (relative == lastRelative) return null;
            lastRelative = relative;
            // Earliest observed delivery offset estimates a common clock. It does NOT measure USB/optical latency.
            offset = Math.Min(offset, receivedAtMs - relative);
            double captured = relative + offset;
            if (captured <= lastCapture) return null;
            lastCapture = captured;
            return new FrameTiming { CapturedAtMs = captured,
                ClockUncertaintyMs = 250 + Math.Abs(colorMs - depthMs) / 2 };
        }
    }

    public static class FrameCodec
    {
        private static bool Finite(double value) { return !Double.IsNaN(value) && !Double.IsInfinity(value); }
        /** SDK results only: invalid camera samples become the agreed zero sentinel.
         * Color outside its camera view is black; depth/XYZ remain usable for planes. */
        public static void RegisterPixel(byte[] bgra, int colorWidth, int colorHeight, ushort[] depth,
            byte[] rgb, float[] xyz, int pixel, float colorX, float colorY, float x, float y, float z)
        {
            int at = pixel * 3;
            rgb[at] = rgb[at + 1] = rgb[at + 2] = 0;
            xyz[at] = xyz[at + 1] = xyz[at + 2] = 0;
            if (depth[pixel] == 0 || !Finite(x) || !Finite(y) || !Finite(z) || z <= 0 ||
                Math.Abs(x) > 100 || Math.Abs(y) > 100 || z > 100) { depth[pixel] = 0; return; }
            xyz[at] = x; xyz[at + 1] = y; xyz[at + 2] = z;
            if (!Finite(colorX) || !Finite(colorY) || colorX < 0 || colorY < 0 || colorX >= colorWidth || colorY >= colorHeight) return;
            int cx = Math.Min(colorWidth - 1, (int)Math.Floor(colorX + .5));
            int cy = Math.Min(colorHeight - 1, (int)Math.Floor(colorY + .5));
            int source = (cy * colorWidth + cx) * 4;
            rgb[at] = bgra[source + 2]; rgb[at + 1] = bgra[source + 1]; rgb[at + 2] = bgra[source];
        }
        public static float[] NormalizeFloorPlane(float x, float y, float z, float w, double relativeAgeMs)
        {
            if (!Finite(x) || !Finite(y) || !Finite(z) || !Finite(w) || !Finite(relativeAgeMs) || Math.Abs(relativeAgeMs) > 250) return null;
            double length = Math.Sqrt((double)x * x + (double)y * y + (double)z * z);
            if (length < .000001) return null; // SDK zero/unavailable floor is not a measurement.
            double distance = w / length;
            if (!Finite(distance) || Math.Abs(distance) > 100) return null;
            return new float[] { (float)(x / length), (float)(y / length), (float)(z / length), (float)distance };
        }
        public static byte[] ToRgb(byte[] bgra)
        {
            if (bgra == null || bgra.Length % 4 != 0) throw new ArgumentException("BGRA pixels must be complete.");
            byte[] rgb = new byte[bgra.Length / 4 * 3];
            for (int i = 0, j = 0; i < bgra.Length; i += 4, j += 3) {
                rgb[j] = bgra[i + 2]; rgb[j + 1] = bgra[i + 1]; rgb[j + 2] = bgra[i];
            }
            return rgb;
        }
        public static void KeepReliableDepth(ushort[] depth, ushort min, ushort max)
        {
            for (int i = 0; i < depth.Length; i++) if (depth[i] < min || depth[i] > max) depth[i] = 0;
        }
        public static byte[] Encode(string metadata, byte[] rgb, ushort[] depth)
        { return Encode(metadata, rgb, depth, null); }
        public static byte[] Encode(string metadata, byte[] rgb, ushort[] depth, float[] cameraPoints)
        {
            byte[] json = new UTF8Encoding(false, true).GetBytes(metadata);
            if (cameraPoints != null && cameraPoints.Length != (long)depth.Length * 3) throw new ArgumentException("XYZ must have three values per depth pixel.");
            if (cameraPoints != null) foreach (float value in cameraPoints) if (!Finite(value) || Math.Abs(value) > 100) throw new ArgumentException("XYZ must use bounded finite meters or the zero sentinel.");
            if (json.Length > 1024 * 1024 || rgb.Length + (long)depth.Length * 2 + (cameraPoints == null ? 0 : (long)cameraPoints.Length * 4) > 12 * 1024 * 1024)
                throw new ArgumentException("Frame exceeds the PMF1 size limit.");
            using (MemoryStream stream = new MemoryStream()) using (BinaryWriter writer = new BinaryWriter(stream)) {
                writer.Write(Encoding.ASCII.GetBytes("PMF1")); writer.Write((uint)json.Length); writer.Write(json); writer.Write(rgb);
                foreach (ushort value in depth) writer.Write(value);
                if (cameraPoints != null) foreach (float value in cameraPoints) writer.Write(value);
                return stream.ToArray();
            }
        }
        public static void WritePacket(Stream output, byte[] packet)
        {
            // Explicit little endian, independent of host byte order.
            uint length = (uint)packet.Length;
            byte[] prefix = { (byte)length, (byte)(length >> 8), (byte)(length >> 16), (byte)(length >> 24) };
            output.Write(prefix, 0, prefix.Length); output.Write(packet, 0, packet.Length); output.Flush();
        }
    }

    /** Throttle expensive conversion, not the SDK's capture clock or USB acquisition. */
    public sealed class CaptureCadence
    {
        private readonly double intervalMs;
        private double last = Double.NegativeInfinity;
        public CaptureCadence(double fps)
        {
            if (Double.IsNaN(fps) || Double.IsInfinity(fps) || fps <= 0 || fps > 30) throw new ArgumentException("Invalid processed frame rate.");
            intervalMs = 1000 / fps;
        }
        public bool Take(double relativeMs)
        {
            if (Double.IsNaN(relativeMs) || Double.IsInfinity(relativeMs) || relativeMs < 0) throw new ArgumentException("Invalid source time.");
            if (relativeMs < last) throw new InvalidOperationException("Sensor clock restarted.");
            if (relativeMs - last < intervalMs) return false;
            last = relativeMs; return true;
        }
    }

    /** One pending frame: acquisition replaces stale work rather than waiting on the stdout consumer. */
    public sealed class LatestMailbox<T> where T : class
    {
        private readonly object gate = new object();
        private T value;
        private bool closed;
        public int Dropped { get; private set; }
        public void Put(T next) { lock (gate) { if (closed) return; if (value != null) Dropped++; value = next; Monitor.Pulse(gate); } }
        public T Take() { lock (gate) { while (value == null && !closed) Monitor.Wait(gate); T next = value; value = null; return next; } }
        public void Close() { lock (gate) { closed = true; value = null; Monitor.PulseAll(gate); } }
    }
}
