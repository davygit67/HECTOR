using System;
using System.IO;
using System.Text;
using System.Threading;
using ProjectionMapper.Sensor;

class CoreTests
{
    static int checks;
    static void Check(bool yes, string message) { if (!yes) throw new Exception(message); checks++; }
    static int Main(string[] args)
    {
        Check(BitConverter.ToString(FrameCodec.ToRgb(new byte[] { 1, 2, 3, 255, 6, 7, 8, 0 })) == "03-02-01-08-07-06", "RGB order");
        bool threw = false; try { FrameCodec.ToRgb(new byte[3]); } catch (ArgumentException) { threw = true; } Check(threw, "Partial pixels rejected");
        ushort[] depth = { 0, 499, 500, 65535, 4500, 4501 }; FrameCodec.KeepReliableDepth(depth, 500, 4500);
        Check(depth[0] == 0 && depth[1] == 0 && depth[2] == 500 && depth[3] == 0 && depth[4] == 4500 && depth[5] == 0, "Invalid depth zeroed");
        byte[] color = { 1, 2, 3, 255, 6, 7, 8, 0 };
        byte[] registered = new byte[6]; float[] xyz = new float[6]; ushort[] measured = { 1000, 2200 };
        FrameCodec.RegisterPixel(color, 2, 1, measured, registered, xyz, 0, .6f, 0, -.25f, .5f, 1);
        Check(registered[0] == 8 && registered[1] == 7 && registered[2] == 6 && xyz[0] == -.25f && xyz[1] == .5f && xyz[2] == 1, "SDK correspondence selects RGB and preserves XYZ");
        FrameCodec.RegisterPixel(color, 2, 1, measured, registered, xyz, 0, float.NegativeInfinity, 0, -.25f, .5f, 1);
        Check(registered[0] == 0 && registered[1] == 0 && registered[2] == 0 && xyz[2] == 1 && measured[0] == 1000, "Invalid color clears old RGB but keeps measured geometry");
        FrameCodec.RegisterPixel(color, 2, 1, measured, registered, xyz, 1, 9, 0, 0, 0, 2.2f);
        Check(registered[3] == 0 && xyz[5] == 2.2f && measured[1] == 2200, "Color outside camera remains black with valid depth");
        FrameCodec.RegisterPixel(color, 2, 1, measured, registered, xyz, 0, 0, 0, float.NaN, .5f, 1);
        Check(xyz[0] == 0 && xyz[1] == 0 && xyz[2] == 0 && measured[0] == 0, "Invalid XYZ clears reused coordinates and depth");
        FrameCodec.RegisterPixel(color, 2, 1, measured, registered, xyz, 0, 0, 0, 0, 0, 1);
        Check(xyz[2] == 0 && registered[0] == 0, "Zero depth cannot resurrect a previous point");
        float[] floor = FrameCodec.NormalizeFloorPlane(0, 2, 0, 3, -50);
        Check(floor != null && floor[1] == 1 && floor[3] == 1.5f, "Floor plane normal and distance normalized together");
        Check(FrameCodec.NormalizeFloorPlane(0, 0, 0, 1, 0) == null && FrameCodec.NormalizeFloorPlane(0, 1, 0, 1, 251) == null, "Unavailable or stale floor omitted");
        Check(FrameCodec.NormalizeFloorPlane(0, float.NaN, 0, 1, 0) == null && FrameCodec.NormalizeFloorPlane(0, .00001f, 0, float.MaxValue, 0) == null, "Nonfinite or out-of-range normalized floor omitted");
        CaptureCadence cadence = new CaptureCadence(5);
        Check(cadence.Take(1000) && !cadence.Take(1033) && !cadence.Take(1199) && cadence.Take(1200), "Expensive conversion throttled to configured cadence");
        threw = false; try { cadence.Take(1100); } catch (InvalidOperationException) { threw = true; } Check(threw, "Cadence rejects clock reversal");
        threw = false; try { new CaptureCadence(31); } catch (ArgumentException) { threw = true; } Check(threw, "Cadence rejects unsupported frame rates");
        CaptureClock clock = new CaptureClock();
        FrameTiming a = clock.Normalize(1000, 1004, 100000);
        Check(a.CapturedAtMs == 100000 && a.ClockUncertaintyMs == 252, "Conservative clock estimate");
        Check(clock.Normalize(1033, 1100, 100050) == null, "Unsynchronized pair rejected");
        Check(clock.Normalize(1000, 1004, 100100) == null, "Duplicate dropped");
        FrameTiming b = clock.Normalize(1033, 1037, 100050);
        Check(b.CapturedAtMs == 100033, "Delivery jitter does not change source time");
        threw = false; try { clock.Normalize(10, 10, 100060); } catch (InvalidOperationException) { threw = true; } Check(threw, "Source clock reset detected");
        threw = false; try { new CaptureClock().Normalize(Double.NaN, 1, 2); } catch (ArgumentException) { threw = true; } Check(threw, "Invalid source clock rejected");
        LatestMailbox<string> queue = new LatestMailbox<string>(); queue.Put("old"); queue.Put("new");
        Check(queue.Take() == "new" && queue.Dropped == 1, "Slow consumer gets latest only");
        string result = "waiting"; Thread consumer = new Thread(delegate() { result = queue.Take(); }); consumer.Start(); queue.Close(); consumer.Join(1000);
        Check(result == null && !consumer.IsAlive, "Shutdown wakes waiting consumer");
        const string metadata = "{\"device\":{\"id\":\"native-fixture\",\"label\":\"Native encoder test\",\"kind\":\"kinect-v2\",\"color\":{\"width\":2,\"height\":1},\"depth\":{\"width\":2,\"height\":1},\"depthScaleMeters\":0.001,\"colorIntrinsics\":null,\"depthIntrinsics\":null,\"depthToColor\":null},\"sequence\":7,\"capturedAtMs\":100000,\"exposureMs\":10,\"clockUncertaintyMs\":250}";
        byte[] packet = FrameCodec.Encode(metadata, new byte[] { 3, 2, 1, 8, 7, 6 }, new ushort[] { 0, 2200 });
        Check(Encoding.ASCII.GetString(packet, 0, 4) == "PMF1", "PMF1 magic");
        Check(packet[packet.Length - 2] == 0x98 && packet[packet.Length - 1] == 0x08, "Depth little endian");
        MemoryStream output = new MemoryStream(); FrameCodec.WritePacket(output, packet);
        Check(BitConverter.ToUInt32(output.ToArray(), 0) == packet.Length, "Native pipe framing");
        if (args.Length >= 1) File.WriteAllBytes(args[0], output.ToArray());
        string registeredMeta = metadata.Replace("\"depthScaleMeters\":", "\"colorRegistration\":\"depth\",\"depthScaleMeters\":");
        registeredMeta = registeredMeta.Substring(0, registeredMeta.Length - 1) + ",\"cameraPointsFormat\":\"xyz-f32-le\",\"floorPlane\":[0,1,0,1.5]}";
        float[] points = { 0, 0, 0, -.25f, .5f, 2.2f };
        byte[] registeredPacket = FrameCodec.Encode(registeredMeta, new byte[] { 0, 0, 0, 8, 7, 6 }, new ushort[] { 0, 2200 }, points);
        int payload = 8 + (int)BitConverter.ToUInt32(registeredPacket, 4);
        Check(registeredPacket.Length == payload + 6 + 4 + 24, "Registered payload has exact RGB/depth/XYZ lengths");
        Check(registeredPacket[payload + 6 + 2] == 0x98 && registeredPacket[payload + 6 + 3] == 0x08, "Depth precedes XYZ");
        Check(registeredPacket[payload + 10 + 12 + 2] == 0x80 && registeredPacket[payload + 10 + 12 + 3] == 0xbe, "XYZ floats little endian");
        threw = false; try { FrameCodec.Encode(registeredMeta, registered, measured, new float[3]); } catch (ArgumentException) { threw = true; } Check(threw, "Truncated XYZ rejected");
        points[1] = float.NaN;
        threw = false; try { FrameCodec.Encode(registeredMeta, registered, measured, points); } catch (ArgumentException) { threw = true; } Check(threw, "NaN XYZ rejected before serialization");
        points[1] = 101;
        threw = false; try { FrameCodec.Encode(registeredMeta, registered, measured, points); } catch (ArgumentException) { threw = true; } Check(threw, "Out-of-range XYZ rejected");
        MemoryStream registeredOutput = new MemoryStream(); FrameCodec.WritePacket(registeredOutput, registeredPacket);
        if (args.Length >= 2) File.WriteAllBytes(args[1], registeredOutput.ToArray());
        Console.WriteLine("Native shared core: " + checks + " checks passed. SDK adapter/USB are not exercised here."); return 0;
    }
}
