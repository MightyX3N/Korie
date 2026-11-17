#!/usr/bin/env python3
"""Checks that the add-ons' content reaches Jellyfin's apps: add-on films in Films, series (with
seasons and episodes) and categories in Series, channels in Live TV, search, playing, resume.
Every answer is read with the real Jellyfin SDK (Check.java), like flow.py.

    addons.py <url> <user> <password> <outdir>
"""
import json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

BASE, USER, PW, OUT = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3], sys.argv[4]
os.makedirs(OUT, exist_ok=True)
AUTH = 'MediaBrowser Client="Android TV", Device="Projector", DeviceId="addoncheck", Version="0.20.0"'
SDK = os.environ.get("JF_SDK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "sdk"))
CP = SDK + ":" + ":".join(os.path.join(SDK, f) for f in os.listdir(SDK) if f.endswith(".jar"))
token = None
steps = []


def call(method, path, body=None, raw=0):
    h = {"Authorization": AUTH + (f', Token="{token}"' if token else ""), "Accept": "application/json"}
    data = json.dumps(body).encode() if body is not None else None
    if data:
        h["Content-Type"] = "application/json"
    t0 = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, method=method, headers=h), timeout=90) as r:
            return r.status, (r.read(raw) if raw else r.read()), r.headers, time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers, time.time() - t0


def step(name, method, path, typ=None, body=None):
    st, b, _, dt = call(method, path, body)
    f = os.path.join(OUT, name + ".json")
    open(f, "wb").write(b)
    steps.append([name, st, typ, f, f"{dt*1000:.0f} ms"])
    try:
        return json.loads(b)
    except Exception:
        return None


def note(name, text, ok=True):
    steps.append([name, "ok" if ok else "FAIL", None, None, text])


PROFILE = {"DirectPlayProfiles": [{"Type": "Video", "Container": "mp4,mkv", "VideoCodec": "h264,hevc", "AudioCodec": "aac,ac3,eac3,mp3"}],
           "TranscodingProfiles": [{"Type": "Video", "Container": "ts", "Protocol": "hls", "VideoCodec": "h264", "AudioCodec": "aac"}],
           "SubtitleProfiles": [{"Format": "vtt", "Method": "External"}, {"Format": "srt", "Method": "Embed"}]}

a = step("01_login", "POST", "/Users/AuthenticateByName", "AuthenticationResult", {"Username": USER, "Pw": PW})
token, uid = a["AccessToken"], a["User"]["Id"]
views = step("02_views", "GET", f"/UserViews?userId={uid}", "BaseItemDtoQueryResult")
vid = {v.get("CollectionType"): v["Id"] for v in views["Items"]}
note("02b_views", ", ".join(f"{v['Name']} ({v.get('CollectionType')})" for v in views["Items"]), "livetv" in vid)

films = step("03_films", "GET", f"/Items?userId={uid}&parentId={vid['movies']}&includeItemTypes=Movie&recursive=true&sortBy=SortName&fields=Overview", "BaseItemDtoQueryResult")
remote = [f for f in films["Items"] if f.get("LocationType") == "Remote"]
note("03b_addon_films", f"{len(remote)} add-on films among {films['TotalRecordCount']} films: " + ", ".join(f["Name"] for f in remote[:5]), len(remote) > 0)
lib = step("04_films_as_is", "GET", f"/Items?userId={uid}&parentId={vid['movies']}&sortBy=SortName", "BaseItemDtoQueryResult")

ser = step("05_series_library", "GET", f"/Items?userId={uid}&parentId={vid['tvshows']}&sortBy=SortName", "BaseItemDtoQueryResult")
kinds = {}
for i in ser["Items"]:
    kinds[i["Type"]] = kinds.get(i["Type"], 0) + 1
note("05b_series_kinds", json.dumps(kinds), kinds.get("Series", 0) > 0)
aseries = [i for i in ser["Items"] if i["Type"] == "Series" and i.get("LocationType") == "Remote"]
if aseries:
    s = aseries[0]
    step("06_addon_series", "GET", f"/Items/{s['Id']}?userId={uid}", "BaseItemDto")
    seasons = step("07_addon_seasons", "GET", f"/Shows/{s['Id']}/Seasons?userId={uid}", "BaseItemDtoQueryResult")
    if seasons and seasons.get("Items"):
        sn = seasons["Items"][0]
        eps = step("08_addon_episodes", "GET", f"/Shows/{s['Id']}/Episodes?userId={uid}&seasonId={sn['Id']}", "BaseItemDtoQueryResult")
        note("08b_episodes", f"{s['Name']} / {sn['Name']}: " + ", ".join(f"{e.get('IndexNumber')}. {e['Name']}" for e in eps["Items"][:4]), len(eps["Items"]) > 0)
        if eps["Items"]:
            step("09_addon_episode", "GET", f"/Items/{eps['Items'][0]['Id']}?userId={uid}", "BaseItemDto")
            st, b, h, dt = call("GET", f"/Items/{eps['Items'][0]['Id']}/Images/Primary?fillWidth=400", raw=200000)
            note("09b_episode_picture", f"{st} {h.get('Content-Type')} {len(b)} bytes", st == 200)
    else:
        note("07b_seasons", "no seasons came back", False)
note("10_no_category_folders", "Series holds series only (categories are genres now)", kinds.get("BoxSet", 0) == 0)
# Films and Series open with rows in the Android TV app (its "smart screen"), Genres a row each
for kind, typ in (("movies", "Movie"), ("tvshows", "Series")):
    dp = step(f"10a_prefs_{kind}", "GET", f"/DisplayPreferences/{vid[kind]}?userId={uid}&client=androidtv", "DisplayPreferencesDto")
    note(f"10b_rows_first_{kind}", f"SmartScreen = {dp.get('CustomPrefs', {}).get('SmartScreen')}", dp.get("CustomPrefs", {}).get("SmartScreen") == "true")
    gen = step(f"10c_genres_{kind}", "GET", f"/Genres?parentId={vid[kind]}&sortBy=SortName&userId={uid}", "BaseItemDtoQueryResult")
    names = [g["Name"] for g in gen["Items"]]
    lst = films if kind == "movies" else ser
    has_addon = any(i.get("LocationType") == "Remote" for i in lst["Items"])
    note(f"10d_genres_{kind}", f"{len(names)}: " + ", ".join(names[:12]), len(names) > 0 or not has_addon)
    if names:
        g = names[len(names) // 2]
        row = step(f"10e_genre_row_{kind}", "GET", f"/Items?userId={uid}&parentId={vid[kind]}&genres={urllib.parse.quote(g)}&includeItemTypes={typ}&recursive=true&sortBy=SortName&limit=40", "BaseItemDtoQueryResult")
        note(f"10f_genre_row_{kind}", f"{g}: {row['TotalRecordCount']} — " + ", ".join(i["Name"] for i in row["Items"][:4]), row["TotalRecordCount"] > 0)
# an add-on on a tile of its own: its categories as folders
for v in views["Items"]:
    if v.get("CollectionType") in (None, "folders"):
        fl = step("10g_own_tile", "GET", f"/Items?userId={uid}&parentId={v['Id']}&sortBy=SortName", "BaseItemDtoQueryResult")
        note("10h_own_tile", f"{v['Name']}: " + ", ".join(f"{f['Name']} ({f.get('ChildCount')})" for f in fl["Items"][:8]), fl["TotalRecordCount"] > 0)
        if fl["Items"]:
            inside = step("10i_own_folder", "GET", f"/Items?userId={uid}&parentId={fl['Items'][2 if len(fl['Items']) > 2 else 0]['Id']}&sortBy=SortName", "BaseItemDtoQueryResult")
            note("10j_own_folder", f"{inside['TotalRecordCount']} inside", inside["TotalRecordCount"] > 0)
            st, b, h, dt = call("GET", f"/Items/{fl['Items'][0]['Id']}/Images/Primary?fillWidth=400", raw=200000)
            note("10k_folder_picture", f"{st} {h.get('Content-Type')} {len(b)} bytes", st == 200)

if "livetv" in vid:
    step("11_livetv_info", "GET", "/LiveTv/Info", "LiveTvInfo")
    ch = step("12_channels", "GET", f"/LiveTv/Channels?userId={uid}&limit=50", "BaseItemDtoQueryResult")
    note("12b_channels", ", ".join(c["Name"] for c in ch["Items"]), len(ch["Items"]) > 0)
    if ch["Items"]:
        pi = step("13_channel_playbackinfo", "POST", f"/Items/{ch['Items'][0]['Id']}/PlaybackInfo?userId={uid}", None, {"DeviceProfile": PROFILE})
        if isinstance(pi, dict) and pi.get("MediaSources"):
            u = pi["MediaSources"][0]["TranscodingUrl"]
            st, b, h, dt = call("GET", u, raw=300000)
            note("13b_channel_stream", f"{st} {h.get('Content-Type')} {len(b)} bytes in {dt:.1f} s", st == 200 and len(b) > 50000)
        else:
            note("13b_channel_stream", f"the add-on couldn't start the channel here: {str(pi)[:160]}", False)

# play an add-on film
sintel = next((f for f in remote if f["Name"] == "Sintel"), remote[0] if remote else None)
if sintel:
    fd = step("14_addon_film", "GET", f"/Items/{sintel['Id']}?userId={uid}", "BaseItemDto")
    # the Android TV app crashes starting an item that doesn't say how it plays
    note("14a_how_it_plays", f"{len(fd.get('MediaSources') or [])} source(s)", bool(fd.get("MediaSources")))
    st, b, h, dt = call("GET", f"/Items/{sintel['Id']}/Images/Primary?fillHeight=600", raw=300000)
    note("14b_poster", f"{st} {h.get('Content-Type')} {len(b)} bytes", st == 200 and len(b) > 5000)
    pi = step("15_film_playbackinfo", "POST", f"/Items/{sintel['Id']}/PlaybackInfo?userId={uid}", "PlaybackInfoResponse", {"DeviceProfile": PROFILE})
    ms = pi["MediaSources"][0]
    note("15b_film_source", f"runtime {round((ms.get('RunTimeTicks') or 0)/1e7)} s, streams {len(ms['MediaStreams'])}, converted: {bool(ms.get('TranscodingUrl'))}", bool(ms.get("TranscodingUrl")))
    t0 = time.time()
    st, b, h, dt = call("GET", ms["TranscodingUrl"], raw=1000000)
    note("16_film_stream", f"{st} {h.get('Content-Type')} {len(b)} bytes, first bytes after {dt:.1f} s", st == 200 and len(b) > 200000)
    step("17_playing", "POST", "/Sessions/Playing", None, {"ItemId": sintel["Id"], "PositionTicks": 0})
    step("18_stopped", "POST", "/Sessions/Playing/Stopped", None, {"ItemId": sintel["Id"], "PositionTicks": 1200000000})
    res = step("19_resume", "GET", f"/UserItems/Resume?userId={uid}&mediaTypes=Video", "BaseItemDtoQueryResult")
    note("19b_resume_has_addon_film", ", ".join(f"{i['Name']} at {round(i['UserData']['PlaybackPositionTicks']/1e7)} s" for i in res["Items"]), any(i["Id"] == sintel["Id"] for i in res["Items"]))
    step("20_favourite", "POST", f"/UserFavoriteItems/{sintel['Id']}?userId={uid}", "UserItemDataDto")

found = step("21_search", "GET", f"/Items?userId={uid}&searchTerm=nosferatu&recursive=true&includeItemTypes=Movie,Series&limit=20", "BaseItemDtoQueryResult")
note("21b_search", ", ".join(f"{i['Name']} ({i.get('LocationType')})" for i in found["Items"]), any(i.get("LocationType") == "Remote" for i in found["Items"]))
found = step("22_search_drtv", "GET", f"/Items?userId={uid}&searchTerm=matador&recursive=true&includeItemTypes=Movie,Series&limit=20", "BaseItemDtoQueryResult")
note("22b_search_drtv", ", ".join(i["Name"] for i in found["Items"][:6]) or "nothing", True)

pairs = [f"{s[2]}={s[3]}" for s in steps if s[2]]
out = subprocess.run(["java", "-cp", CP, "Check", *pairs], capture_output=True, text=True, cwd=SDK)
verdict = {}
lines = out.stdout.splitlines()
for i, l in enumerate(lines):
    if l.startswith("OK") or l.startswith("FAIL"):
        verdict[l.split()[-1]] = "SDK ok" if l.startswith("OK") else "SDK FAILED: " + (lines[i + 1].strip() if i + 1 < len(lines) else "")
bad = 0
for s in steps:
    v = verdict.get(s[3], "")
    failed = (isinstance(s[1], int) and s[1] >= 400) or s[1] == "FAIL" or "FAILED" in v
    bad += failed
    print(f"{'!!' if failed else '  '} {s[0]:<26} {str(s[1]):<5} {v:<8} {s[4]}")
print(f"\n{len(steps)} steps, {bad} failed")
