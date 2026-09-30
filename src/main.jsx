import React from "react";
import {createRoot} from "react-dom/client";
import {App} from "./App.jsx";
import {Widget} from "./widget.jsx";
import {ErrorBoundary} from "./ErrorBoundary.jsx";
import "./style.css";
import "./glass.css";
import "./product.css";

createRoot(document.getElementById("root")).render(new URLSearchParams(location.search).has('widget') ? <Widget /> : <ErrorBoundary><App /></ErrorBoundary>);
