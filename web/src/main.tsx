import { createRoot } from "react-dom/client";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-semi-condensed/600.css";
import "@fontsource/barlow-semi-condensed/700.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/big-shoulders-display/700";
import "@fontsource/big-shoulders-display/800";
import "./watch.css";
import "./admin.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
