#!/usr/bin/env python3
"""Walks a Jellyfin server through what the Android TV app does, the way its SDK sends it (camelCase
query names, the app's auth header), saves every answer, and decodes each with the real Jellyfin
Kotlin SDK (Check.java). Run against real Jellyfin and against Korie; prints a report.

    flow.py <base url> <username> <password> <outdir>
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error, urllib.parse

BASE, USER, PW, OUT = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3], sys.argv[4]
os.makedirs(OUT, exist_ok=True)
AUTH = 'MediaBrowser Client="Android TV", Device="Google TV Streamer", DeviceId="flowtest", Version="0.20.0"'
token = None
steps = []  # (name, status, type, file, note)
SDK = os.environ.get("JF_SDK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "sdk"))  # get_sdk.sh fills it
CP = SDK + ":" + ":".join(os.path.join(SDK, f) for f in os.listdir(SDK) if f.endswith(".jar"))


def call(method, path, body=None, raw=False, headers=None):
    h = {"Authorization": AUTH + (f', Token="{token}"' if token else ""), "Accept": "application/json"}
    h.update(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            b = r.read(400000 if raw else None)
            return r.status, b, r.headers, time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers, time.time() - t0


def step(name, method, path, typ=None, body=None):
    st, b, _, dt = call(method, path, body)
    f = os.path.join(OUT, name + ".json")
    open(f, "wb").write(b)
    steps.append([name, st, typ, f, f"{dt*1000:.0f} ms"])
    try:
        return json.loads(b) if b else None
    except Exception:
        return None


ANDROID_PROFILE = {
    "Name": "AndroidTV-ExoPlayer", "MaxStreamingBitrate": 120000000,
    "DirectPlayProfiles": [{"Type": "Video", "Container": "mp4,mkv,webm,ts,mov", "VideoCodec": "h264,hevc,vp9,av1,mpeg4", "AudioCodec": "aac,mp3,ac3,eac3,opus,flac,vorbis,dts,truehd"}],
    "TranscodingProfiles": [{"Type": "Video", "Container": "ts", "Protocol": "hls", "VideoCodec": "h264", "AudioCodec": "aac,mp3,ac3", "Context": "Streaming"}],
    "SubtitleProfiles": [{"Format": f, "Method": "Embed"} for f in ["srt", "subrip", "ass", "ssa", "vtt", "pgssub", "dvdsub"]] + [{"Format": f, "Method": "External"} for f in ["srt", "subrip", "vtt", "ass", "ssa"]],
    "CodecProfiles": [], "ContainerProfiles": [],
}

info = step("01_public_info", "GET", "/System/Info/Public", "PublicSystemInfo")
users = step("02_public_users", "GET", "/Users/Public", "List<UserDto>")
auth = step("03_login", "POST", "/Users/AuthenticateByName", "AuthenticationResult", {"Username": USER, "Pw": PW})
token = auth["AccessToken"]
uid = auth["User"]["Id"]
step("04_me", "GET", "/Users/Me", "UserDto")
step("05_display_prefs", "GET", f"/DisplayPreferences/usersettings?userId={uid}&client=emby", "DisplayPreferencesDto")
views = step("06_views", "GET", f"/UserViews?userId={uid}&includeExternalContent=false", "BaseItemDtoQueryResult")
step("07_resume", "GET", f"/UserItems/Resume?userId={uid}&limit=50&fields=Overview,PrimaryImageAspectRatio&imageTypeLimit=1&enableImageTypes=Primary,Backdrop,Thumb&mediaTypes=Video&excludeItemTypes=AudioBook", "BaseItemDtoQueryResult")
step("08_nextup", "GET", f"/Shows/NextUp?userId={uid}&limit=50&fields=Overview&imageTypeLimit=1&enableImageTypes=Primary,Backdrop,Thumb", "BaseItemDtoQueryResult")
vid = {v["CollectionType"]: v["Id"] for v in views["Items"]}
for ct, i in vid.items():
    step(f"09_latest_{ct}", "GET", f"/Items/Latest?userId={i and uid}&parentId={i}&limit=50&fields=Overview&imageTypeLimit=1&enableImageTypes=Primary,Backdrop,Thumb&groupItems=true", "List<BaseItemDto>")
films = step("10_films", "GET", f"/Items?userId={uid}&parentId={vid['movies']}&includeItemTypes=Movie&recursive=true&sortBy=SortName&sortOrder=Ascending&fields=Overview,PrimaryImageAspectRatio,ChildCount&imageTypeLimit=1&enableImageTypes=Primary,Backdrop,Thumb&startIndex=0&limit=100", "BaseItemDtoQueryResult")
movie = next(x for x in films["Items"] if x["Name"].startswith("Sintel") or "sintel" in x["Name"].lower())
step("11_movie", "GET", f"/Items/{movie['Id']}?userId={uid}", "BaseItemDto")
step("11b_similar", "GET", f"/Items/{movie['Id']}/Similar?userId={uid}&limit=10", "BaseItemDtoQueryResult")
step("11c_trailers", "GET", f"/Items/{movie['Id']}/LocalTrailers?userId={uid}", "List<BaseItemDto>")
step("11d_special", "GET", f"/Items/{movie['Id']}/SpecialFeatures?userId={uid}", "List<BaseItemDto>")
pi = step("12_playbackinfo", "POST", f"/Items/{movie['Id']}/PlaybackInfo?userId={uid}", "PlaybackInfoResponse",
          {"UserId": uid, "DeviceProfile": ANDROID_PROFILE, "MaxStreamingBitrate": 120000000, "StartTimeTicks": 0, "EnableDirectPlay": True, "EnableDirectStream": True, "EnableTranscoding": True, "AutoOpenLiveStream": True})
ms = pi["MediaSources"][0]
steps.append(["12b_decision", "-", None, None, f"direct play={ms.get('SupportsDirectPlay')} transcode url={'yes' if ms.get('TranscodingUrl') else 'no'} streams={len(ms.get('MediaStreams') or [])} runtime={ms.get('RunTimeTicks')}"])
st, b, hd, dt = call("GET", f"/Videos/{movie['Id']}/stream?static=true&mediaSourceId={ms['Id']}&api_key={token}", raw=True, headers={"Range": "bytes=0-"})
steps.append(["13_stream_static", st, None, None, f"{len(b)} bytes read, type {hd.get('Content-Type')}, {dt*1000:.0f} ms to first bytes"])
st, b, hd, dt = call("GET", f"/Items/{movie['Id']}/Images/Primary?fillHeight=600&fillWidth=400&quality=96", raw=True)
steps.append(["14_poster", st, None, None, f"{len(b)} bytes, {hd.get('Content-Type')}"])
# play, report progress, stop halfway
step("15_playing", "POST", "/Sessions/Playing", None, {"ItemId": movie["Id"], "MediaSourceId": ms["Id"], "PositionTicks": 0, "PlayMethod": "DirectPlay", "CanSeek": True, "IsPaused": False})
step("16_progress", "POST", "/Sessions/Playing/Progress", None, {"ItemId": movie["Id"], "MediaSourceId": ms["Id"], "PositionTicks": 300000000, "PlayMethod": "DirectPlay", "IsPaused": False, "CanSeek": True})
step("17_stopped", "POST", "/Sessions/Playing/Stopped", None, {"ItemId": movie["Id"], "MediaSourceId": ms["Id"], "PositionTicks": 300000000})
res = step("18_resume_after", "GET", f"/UserItems/Resume?userId={uid}&limit=50&mediaTypes=Video", "BaseItemDtoQueryResult")
steps.append(["18b_resume_has_movie", "-", None, None, str(any(x["Id"] == movie["Id"] for x in res["Items"]))])
# series
ser = step("19_series", "GET", f"/Items?userId={uid}&parentId={vid['tvshows']}&includeItemTypes=Series&recursive=true&sortBy=SortName&fields=Overview,PrimaryImageAspectRatio,ChildCount&imageTypeLimit=1&enableImageTypes=Primary,Backdrop,Thumb", "BaseItemDtoQueryResult")
arc = next(x for x in ser["Items"] if x["Name"] == "Arcane")
step("20_series_item", "GET", f"/Items/{arc['Id']}?userId={uid}", "BaseItemDto")
seasons = step("21_seasons", "GET", f"/Shows/{arc['Id']}/Seasons?userId={uid}&fields=Overview", "BaseItemDtoQueryResult")
s1 = seasons["Items"][0]
eps = step("22_episodes", "GET", f"/Shows/{arc['Id']}/Episodes?userId={uid}&seasonId={s1['Id']}&fields=Overview,PrimaryImageAspectRatio", "BaseItemDtoQueryResult")
steps.append(["22b_episode_names", "-", None, None, ", ".join(f"{e.get('IndexNumber')}:{e['Name']}" for e in eps["Items"])])
ep1 = eps["Items"][0]
step("23_episode", "GET", f"/Items/{ep1['Id']}?userId={uid}", "BaseItemDto")
step("24_played", "POST", f"/UserPlayedItems/{ep1['Id']}?userId={uid}", "UserItemDataDto")
nu = step("25_nextup_after", "GET", f"/Shows/NextUp?userId={uid}&limit=50", "BaseItemDtoQueryResult")
steps.append(["25b_nextup_is_ep2", "-", None, None, ", ".join(f"{e.get('SeriesName')} {e.get('ParentIndexNumber')}x{e.get('IndexNumber')}" for e in nu["Items"])])
step("26_favorite", "POST", f"/UserFavoriteItems/{movie['Id']}?userId={uid}", "UserItemDataDto")
step("27_segments", "GET", f"/MediaSegments/{ep1['Id']}", "MediaSegmentDtoQueryResult")
step("28_unplayed", "DELETE", f"/UserPlayedItems/{ep1['Id']}?userId={uid}", "UserItemDataDto")
step("29_search", "GET", f"/Items?userId={uid}&searchTerm=sin&recursive=true&includeItemTypes=Movie,Series&limit=20", "BaseItemDtoQueryResult")
sub = next((s for s in ms.get("MediaStreams") or [] if s.get("Type") == "Subtitle"), None)
if sub:
    st, b, hd, dt = call("GET", f"/Videos/{movie['Id']}/{ms['Id']}/Subtitles/{sub['Index']}/0/Stream.vtt?api_key={token}", raw=True)
    steps.append(["30_subtitles", st, None, None, f"{b[:40]!r}"])

# decode every saved answer with the real SDK
pairs = [f"{s[2]}={s[3]}" for s in steps if s[2]]
out = subprocess.run(["java", "-cp", CP, "Check", *pairs], capture_output=True, text=True, cwd=SDK)
verdict = {}
lines = [l for l in out.stdout.splitlines()]
for i, l in enumerate(lines):
    if l.startswith("OK") or l.startswith("FAIL"):
        f = l.split()[-1]
        verdict[f] = "SDK ok" if l.startswith("OK") else "SDK FAILED: " + (lines[i + 1].strip() if i + 1 < len(lines) else "")
for s in steps:
    v = verdict.get(s[3], "")
    print(f"{s[0]:<24} {str(s[1]):<4} {v:<10} {s[4]}")
fails = [s for s in steps if (isinstance(s[1], int) and s[1] >= 400) or "FAILED" in verdict.get(s[3], "")]
print(f"\n{len(steps)} steps, {len(fails)} failed")
sys.exit(1 if fails else 0)
