import { ConvexError } from "convex/values";

// localStorage can throw (private windows, blocked storage); fall back to memory.
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

export function getStudentId(): string {
  let id = read("studentId");
  if (id === null) {
    id = crypto.randomUUID();
    write("studentId", id);
  }
  return id;
}

export function saveCourseToken(courseId: string, token: string) {
  write(`courseToken:${courseId}`, token);
}

export function getCourseToken(courseId: string): string | null {
  return read(`courseToken:${courseId}`);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === "string") return err.data;
  return "Something went wrong. Try again.";
}
