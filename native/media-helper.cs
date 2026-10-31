// Lyric Stars media helper: reads the Windows media session (what Spotify, or another
// player, shows in the volume pop-up) and prints one JSON line per tick on stdout.
//
// Built with the C# compiler that ships with Windows (tools/build-helper.mjs), so it
// needs no .NET install. Exits when its parent closes stdin, so it never outlives the app.
//
//   lyricstars-media.exe [--interval=100]
//
// Line: { ok, nowMs, session, app, title, artist, album, status, positionMs, durationMs, lastUpdatedMs }
//       or { ok:false, error }. Spotify is preferred; otherwise the playing (or current) player.
using System;
using System.Text;
using System.Threading;
using Windows.Foundation;
using Windows.Media.Control;

static class MediaHelper
{
    static readonly DateTimeOffset Epoch = DateTimeOffset.FromUnixTimeMilliseconds(0);

    static T Wait<T>(IAsyncOperation<T> op, int timeoutMs)
    {
        var until = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (op.Status == AsyncStatus.Started)
        {
            if (DateTime.UtcNow > until) { op.Cancel(); throw new TimeoutException("Windows did not answer in time"); }
            Thread.Sleep(2);
        }
        if (op.Status != AsyncStatus.Completed) throw op.ErrorCode ?? new Exception("WinRT call " + op.Status);
        return op.GetResults();
    }

    static bool IsSpotify(GlobalSystemMediaTransportControlsSession s)
    {
        return s.SourceAppUserModelId.IndexOf("spotify", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    static bool IsPlaying(GlobalSystemMediaTransportControlsSession s)
    {
        return s.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
    }

    // Spotify first; otherwise a playing player (the one Windows calls current wins),
    // otherwise the current player even if paused.
    static GlobalSystemMediaTransportControlsSession Pick(GlobalSystemMediaTransportControlsSessionManager mgr)
    {
        GlobalSystemMediaTransportControlsSession current = mgr.GetCurrentSession(), playing = null;
        foreach (var s in mgr.GetSessions())
        {
            if (IsSpotify(s)) return s;
            if (playing == null && IsPlaying(s)) playing = s;
        }
        if (current != null && IsPlaying(current)) return current;
        return playing ?? current;
    }

    static void Main(string[] args)
    {
        int interval = 100;
        foreach (var a in args)
            if (a.StartsWith("--interval=")) interval = Math.Max(20, int.Parse(a.Substring(11)));

        // Parent gone (stdin closed): exit.
        var watcher = new Thread(() => { try { while (Console.In.Read() != -1) { } } catch { } Environment.Exit(0); });
        watcher.IsBackground = true;
        watcher.Start();

        GlobalSystemMediaTransportControlsSessionManager mgr = null;
        GlobalSystemMediaTransportControlsSessionMediaProperties props = null;
        string lastKey = null;
        long lastPos = 0;
        var propsAt = DateTime.MinValue;
        var output = Console.Out;

        while (true)
        {
            var sb = new StringBuilder("{");
            Field(sb, "nowMs", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            bool playing = false;
            try
            {
                if (mgr == null) mgr = Wait(GlobalSystemMediaTransportControlsSessionManager.RequestAsync(), 5000);
                var s = Pick(mgr);
                if (s == null)
                {
                    Field(sb, "ok", true);
                    Field(sb, "session", false);
                    props = null;
                }
                else
                {
                    var tl = s.GetTimelineProperties();
                    var info = s.GetPlaybackInfo();
                    playing = info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
                    long pos = (long)Math.Round(tl.Position.TotalMilliseconds);
                    // Title and artist are slower to read. Re-read on a new player or duration, a jump
                    // back to the start (next song of the same length), and at least twice a second.
                    string key = s.SourceAppUserModelId + "|" + tl.StartTime.Ticks + "|" + tl.EndTime.Ticks;
                    bool restarted = pos < lastPos - 2000 && pos < 5000;
                    lastPos = pos;
                    if (props == null || key != lastKey || restarted || (DateTime.UtcNow - propsAt).TotalMilliseconds > 500)
                    {
                        props = Wait(s.TryGetMediaPropertiesAsync(), 1500);
                        propsAt = DateTime.UtcNow;
                        lastKey = key;
                    }
                    Field(sb, "ok", true);
                    Field(sb, "session", true);
                    Field(sb, "app", s.SourceAppUserModelId);
                    Field(sb, "title", props.Title);
                    Field(sb, "artist", props.Artist);
                    Field(sb, "album", props.AlbumTitle);
                    Field(sb, "status", info.PlaybackStatus.ToString());
                    Field(sb, "positionMs", pos);
                    Field(sb, "durationMs", (long)Math.Round((tl.EndTime - tl.StartTime).TotalMilliseconds));
                    Field(sb, "lastUpdatedMs", (long)Math.Round((tl.LastUpdatedTime - Epoch).TotalMilliseconds));
                }
            }
            catch (Exception e)
            {
                sb.Length = 1;
                Field(sb, "nowMs", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                Field(sb, "ok", false);
                Field(sb, "error", e.Message);
                mgr = null;
                props = null;
            }
            sb.Length--; // trailing comma
            sb.Append('}');
            output.WriteLine(sb.ToString());
            output.Flush();
            // Nothing playing: check less often.
            Thread.Sleep(playing ? interval : interval * 4);
        }
    }

    static void Field(StringBuilder sb, string name, object value)
    {
        sb.Append('"').Append(name).Append("\":");
        if (value is bool) sb.Append((bool)value ? "true" : "false");
        else if (value is long) sb.Append((long)value);
        else Str(sb, value as string);
        sb.Append(',');
    }

    static void Str(StringBuilder sb, string s)
    {
        if (s == null) { sb.Append("null"); return; }
        sb.Append('"');
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c < 0x20 || c == 0x2028 || c == 0x2029) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        sb.Append('"');
    }
}
