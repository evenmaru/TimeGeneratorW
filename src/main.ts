import { createApp } from "./app/createApp";
import "./styles/index.css";

const root = document.querySelector<HTMLElement>("#app");

if (root === null) {
  throw new Error("앱 마운트 요소를 찾을 수 없습니다.");
}

createApp(root);
