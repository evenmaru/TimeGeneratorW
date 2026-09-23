import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig(() => {
  const useLocalSession = process.env.VITE_USE_LOCAL_SESSION === "1";
  const firebaseStub = fileURLToPath(new URL("./tests/e2e/firebase-stub.ts", import.meta.url));

  return {
    base: "./",
    resolve: {
      alias: useLocalSession
        ? [
            { find: "firebase/app", replacement: firebaseStub },
            { find: "firebase/auth", replacement: firebaseStub },
            { find: "firebase/firestore", replacement: firebaseStub },
          ]
        : [],
    },
  };
});
