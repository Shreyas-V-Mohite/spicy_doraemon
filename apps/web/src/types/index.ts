export interface PublicSession {
  _id: string;
  code: string;
  topic: string;
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
