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
        if (args.Length == 1) File.WriteAllBytes(args[0], output.ToArray());
        Console.WriteLine("Native shared core: " + checks + " checks passed. SDK adapter/USB are not exercised here."); return 0;
    }
}
