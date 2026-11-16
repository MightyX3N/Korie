// Decodes server answers with the Jellyfin Kotlin SDK (the one the Android TV app uses), with the
// SDK's own JSON settings. An answer the app can't read fails here the same way.
// java Check Type=file.json [List<Type>=file.json] ...
import java.nio.file.*;
import kotlinx.serialization.KSerializer;
import kotlinx.serialization.builtins.BuiltinSerializersKt;
import org.jellyfin.sdk.api.client.util.ApiSerializer;

public class Check {
    static KSerializer<?> ser(String name) throws Exception {
        if (name.startsWith("List<")) return BuiltinSerializersKt.ListSerializer(ser(name.substring(5, name.length() - 1)));
        if (name.equals("Boolean")) return BuiltinSerializersKt.serializer(kotlin.jvm.internal.BooleanCompanionObject.INSTANCE);
        if (name.equals("String")) return BuiltinSerializersKt.serializer(kotlin.jvm.internal.StringCompanionObject.INSTANCE);
        Class<?> c = Class.forName("org.jellyfin.sdk.model.api." + name);
        Object companion = c.getField("Companion").get(null);
        return (KSerializer<?>) companion.getClass().getMethod("serializer").invoke(companion);
    }

    public static void main(String[] args) throws Exception {
        int bad = 0;
        for (String a : args) {
            int i = a.indexOf('=');
            String type = a.substring(0, i), file = a.substring(i + 1);
            String text = Files.readString(Path.of(file));
            try {
                Object o = ApiSerializer.INSTANCE.getJson().decodeFromString(ser(type), text);
                System.out.println("OK    " + type + "  " + file);
            } catch (Exception e) {
                bad++;
                String m = String.valueOf(e.getMessage()).replace('\n', ' ');
                System.out.println("FAIL  " + type + "  " + file + "\n      " + (m.length() > 400 ? m.substring(0, 400) : m));
            }
        }
        System.exit(bad == 0 ? 0 : 1);
    }
}
