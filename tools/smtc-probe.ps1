# Windows media-session probe (spike for milestone 1).
# Prints one JSON line per tick describing the Spotify desktop session.
# Run by server.js; also runnable by hand:  powershell -NoProfile -File tools\smtc-probe.ps1
param([int]$IntervalMs = 200)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, [Type]$type) {
    $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$manager = Await ($mgrType::RequestAsync()) $mgrType

$epoch = [DateTimeOffset]::FromUnixTimeMilliseconds(0)
$lastTitleKey = $null
$props = $null
$tick = 0

while ($true) {
    $tick++
    $out = @{ ok = $true; nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    try {
        $session = $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' } | Select-Object -First 1
        if ($null -eq $session) {
            $out.session = $false
        } else {
            $out.session = $true
            $tl = $session.GetTimelineProperties()
            $info = $session.GetPlaybackInfo()
            # Media properties are slower to read: refresh on timeline change and about once a second.
            $titleKey = "$($tl.EndTime.Ticks)|$($tl.StartTime.Ticks)"
            if ($titleKey -ne $lastTitleKey -or $null -eq $props -or ($tick % 5) -eq 0) {
                $props = Await ($session.TryGetMediaPropertiesAsync()) $propsType
                $lastTitleKey = $titleKey
            }
            $out.title = $props.Title
            $out.artist = $props.Artist
            $out.album = $props.AlbumTitle
            $out.status = "$($info.PlaybackStatus)"
            $out.positionMs = [math]::Round($tl.Position.TotalMilliseconds)
            $out.durationMs = [math]::Round(($tl.EndTime - $tl.StartTime).TotalMilliseconds)
            $out.lastUpdatedMs = [math]::Round(($tl.LastUpdatedTime - $epoch).TotalMilliseconds)
        }
    } catch {
        $out.ok = $false
        $out.error = "$_"
        $props = $null
    }
    [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds $IntervalMs
}
