export interface PublicSession {
  _id: string;
  code: string;
  topic: string;
  courseId?: string;
}

export interface Question {
  _id: string;
  text: string;
  status: "open" | "answered";
  _creationTime: number;
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

export interface Suggestion {
  _id: string;
  questionId: string;
  explanation: string;
  sourceIds: string[];
  teachingAction: string;
  molecule?: string;
  groupId?: string;
  previewId?: string;
  note?: string;
  cached: boolean;
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
