import { useEffect, useState } from "react";
import HomePage from "@/app/page";
import RoomPage from "@/app/room/[roomCode]/page";

function currentPath() {
  return window.location.pathname;
}

export default function App() {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    function handleRouteChange() {
      setPath(currentPath());
    }

    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("app-route-change", handleRouteChange);

    return () => {
      window.removeEventListener("popstate", handleRouteChange);
      window.removeEventListener("app-route-change", handleRouteChange);
    };
  }, []);

  if (/^\/room\/[^/]+/.test(path)) {
    return <RoomPage />;
  }

  return <HomePage />;
}
