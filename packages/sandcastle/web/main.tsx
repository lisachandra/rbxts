import { StrictMode } from "react";

import "@xyflow/react/dist/style.css";

import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./theme.css";

const container = document.querySelector("#root");
if (container === null) {
	throw new Error("The page is missing its #root element.");
}

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
