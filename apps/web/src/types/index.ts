export interface PublicSession {
  _id: string;
  code: string;
  topic: string;
  courseId?: string;
  transcribing?: boolean;
  // The live room.
  hasSlides: boolean;
  slideCount: number;
  slideIndex: number;
  stageMode: "slides" | "molecule";
  broadcasting: boolean;
  liveEpoch: number;
  handMode: boolean;
  // While > now, a student needs the relayed (Convex) camera feed.
  relayUntil: number;
}

export interface SlideMolecules {
  slideIndex: number;
  molecules: { name: string; smiles: string }[];
}

export interface RelayChunk {
  seq: number;
  data: ArrayBuffer;
}

export interface SlideFeedback {
  slideIndex: number;
  confused: number;
  understood: number;
}

export type SignalKind = "join" | "offer" | "answer" | "ice" | "leave";

export interface Signal {
  _id: string;
  from: string;
  kind: SignalKind;
  payload: string;
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
  slideIndex: number | null;
  // The student asked for the professor after reading the AI answer.
  escalated: boolean;
  escalationNote: string | null;
  professorReply: string | null;
  answerStatus: AnswerStatus | null;
  answerNote: string | null;
  answerText: string | null;
  answerConflict: boolean;
}

// One card in the professor's queue: a single question, or several students'
// similar questions grouped together.
export interface QueueCard {
  key: string;
  groupId: string | null;
  label: string | null;
  studentCount: number;
  open: boolean;
  flagged: boolean;
  members: Question[];
}

// A student's own question with the answer they were shown.
export interface MyQuestion {
  _id: string;
  text: string;
  status: "open" | "answered";
  _creationTime: number;
  // Other students who asked something similar (a count only).
  similarCount: number;
  escalated: boolean;
  professorReply: string | null;
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

export type MoleculeStyle = "stick" | "ball-and-stick" | "spacefill";

// A molecule shared with the class (what students receive).
export interface Visual {
  query: string;
  smiles: string;
  sdf: string;
  groupId: string | null;
  // The functional group's name, or the molecule's when nothing is highlighted.
  label: string;
  indices: number[];
  style: MoleculeStyle;
}

// A functional group RDKit found in a loaded molecule.
export interface DetectedGroup {
  id: string;
  label: string;
  indices: number[];
}

export interface LoadedMolecule {
  query: string;
  cid: number | undefined;
  smiles: string;
  sdf: string;
  groups: DetectedGroup[];
}

export interface SharedAnswer {
  question: string;
  answer: string;
  quotes: { label: string; text: string }[];
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

export interface TranscriptLine {
  _id: string;
  text: string;
  startedAt: number;
}
