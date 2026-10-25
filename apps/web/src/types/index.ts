export interface PublicSession {
  _id: string;
  code: string;
  topic: string;
  courseId?: string;
}

export type AnswerStatus =
  | "pending"
  | "answered"
  | "fallback"
  | "not_covered"
  | "failed";

// A question as the professor sees it, with how the automatic answer went.
export interface Question {
  _id: string;
  text: string;
  status: "open" | "answered";
  _creationTime: number;
  answerStatus: AnswerStatus | null;
  answerNote: string | null;
  answerText: string | null;
}

// A student's own question with the answer they were shown.
export interface MyQuestion {
  _id: string;
  text: string;
  status: "open" | "answered";
  _creationTime: number;
  answer: {
    status: AnswerStatus;
    text: string | null;
    quotes: { label: string; text: string }[];
  } | null;
}

export interface FeedbackCounts {
  confused: number;
  understood: number;
}

export type FeedbackValue = "confused" | "understood";

export interface Visual {
  query: string;
  smiles: string;
  sdf: string;
  groupId: string;
  label: string;
  indices: number[];
}

export interface Preview extends Visual {
  _id: string;
}

export interface Course {
  _id: string;
  name: string;
}

export interface Lesson {
  _id: string;
  title: string;
  wordCount: number;
  chunkCount: number;
  status: "saving" | "ready";
}

export interface CourseSession {
  _id: string;
  code: string;
  topic: string;
  _creationTime: number;
}
