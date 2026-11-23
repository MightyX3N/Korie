# Bundled libraries

| File | What | Licence | Source |
|---|---|---|---|
| `osmdroid-android-6.1.20.jar`, `osmdroid-res/` | osmdroid map view (classes and resources of the AAR) | Apache-2.0 | Maven Central `org.osmdroid:osmdroid-android:6.1.20`, AAR sha1 `9e32a3531525ab4caa023da7144549efaa9e69bb` |
| `luaj-3.0.1-core.jar` | LuaJ, the Lua interpreter add-ons run in (core classes only) | MIT (`LuaJ-LICENSE.txt`) | luaj.org 3.0.1 |
| `m3/*.jar`, `m3-res/` | AndroidX Media3 1.11.1 (exoplayer, exoplayer-hls, ui) with its dependencies: AndroidX core, recyclerview, lifecycle and others, Guava, Kotlin stdlib (classes and resources of the AARs) | Apache-2.0 | Google Maven (`androidx.media3`, `androidx.*`) and Maven Central (Guava, Kotlin) |

osmdroid's repository was archived by its owners on 2024-11-20 (no further releases). It is used
here only to draw the map behind the dock, behind `MapShelf`, so it can be swapped for another
map view without touching Home.
