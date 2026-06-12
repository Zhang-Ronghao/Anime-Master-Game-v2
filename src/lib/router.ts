export function useRouter() {
  return {
    push(path: string) {
      window.history.pushState(null, "", path);
      window.dispatchEvent(new Event("app-route-change"));
    },
  };
}

export function useParams<T extends Record<string, string>>() {
  const roomMatch = window.location.pathname.match(/^\/room\/([^/]+)/);
  return {
    roomCode: roomMatch ? decodeURIComponent(roomMatch[1]) : "",
  } as unknown as T;
}
