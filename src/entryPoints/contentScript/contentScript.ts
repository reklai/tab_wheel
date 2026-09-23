// Content script entry, injected into every frame of viable pages (declared in
// the manifest and re-injected by the background after installs, updates, and
// the Refresh button). All gesture handling lives in appInit; initApp tears
// down any previous instance first, so repeated injection is safe.

import { initApp } from "../../lib/appInit/appInit";

initApp();
