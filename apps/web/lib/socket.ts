import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getLogSocket(): Socket {
  if (!socket) {
    const base = process.env.NEXT_PUBLIC_HUMA_API_URL ?? 'http://localhost:3100';
    socket = io(base, { path: '/ws/logs', autoConnect: false });
  }
  return socket;
}
