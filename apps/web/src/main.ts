import { mountApp } from "./App";

const root = document.querySelector<HTMLElement>("#root");

if (!root) {
  throw new Error("Missing #root mount element.");
}

mountApp(root);
