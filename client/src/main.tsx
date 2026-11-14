import { createRoot } from "react-dom/client";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-semi-condensed/600.css";
import "./styles.css";
import { startSizing } from "./size.ts";
import { startFocus } from "./focus.tsx";
import { App } from "./App.tsx";

startSizing();
startFocus();
createRoot(document.getElementById("root")!).render(<App />);
