# Pitch

## One line

An agent that closes the understanding gap between the person explaining and the people listening, using only material the explainer trusts.

The classroom is the proof case. The same loop works in a sales call, an onboarding session or a training.

## Why it counts as an agent

The case rests on the goal and the loop, not on the number of model calls.

1. **It has a goal.** Both sides reach the same understanding.
2. **It senses.** Questions, confused/understood votes, the live transcript and what is on screen.
3. **It decides.** Answer, abstain ("your material doesn't cover this"), reuse a verified answer, or escalate to the professor.
4. **It acts.** It answers with verified quotes, groups similar doubts, and puts a molecule or an answer on every screen.
5. **It stays accountable.** Claude proposes, code verifies, and the professor decides what everyone sees.

Be precise when asked: the answer path is one Claude step inside a fixed pipeline (plus a second small call that labels question groups). Call it an agentic pipeline or a grounded answer agent, not a multi-agent system.

## Two sides, one workflow

| | Classroom | Sales call |
|---|---|---|
| Explainer | Professor | Sales rep |
| Listener | Student | Client |
| Source of truth | Lessons and lecture transcript | Product docs, pricing, security material |
| A doubt is resolved by | A verified answer from the lesson | A verified answer from approved material |
| "Not covered" means | The professor sees a gap in the lesson | The rep sees a gap in the collateral and can answer honestly instead of guessing |
| Confused / understood | Is the class following? | Is the client following? |
| Outcome | Everyone leaves with the same picture | The client has no open doubts and can decide yes or no |

### What the live room adds to the mapping

| Feature | Classroom | Sales call |
|---|---|---|
| PDF slides every student follows | Lecture slides | The deck or demo |
| Professor camera and mic in the app | The lecture | The rep on the call |
| Claude reads each slide and shares its molecule | The compound being taught | The product visual being discussed |
| Votes per slide, "where the class got lost" | Which slides lost the class | Which parts of the pitch lost the client |
| Escalate an AI answer, professor replies privately | A student who still wants a person | A client who wants the rep |
| AI answers first, only the rest reach the professor | The professor keeps teaching | The rep keeps selling |

The promise is a clear picture, not a closed deal. A client who decides not to buy with full understanding is also a success.

## 45-second narrative

> In any explanation, the explainer can't see who's lost. A professor can't tell which of 100 students are confused, and a sales rep can't tell which doubts a client is sitting on. Our agent listens to the live session, answers each person's doubt using only the material the explainer trusts, and checks every quote word for word. It shows the explainer what the material couldn't answer, so the gaps are visible. The goal is the same on both sides: everyone leaves with the same clear picture. Today it's a chemistry classroom, and the workflow is identical for a sales call.

## Demo beats

1. A student asks a question. The answer appears with quotes, labelled by source.
2. A question the lesson doesn't cover gets "not covered" and is flagged to the professor. This is the unresolved doubt.
3. Three students ask similar things. The professor sees one card with a count.
4. The professor shares a verified molecule with a highlighted functional group, and the whole class sees the same picture.
5. Close: swap the lessons for a product doc set and the student for a client, and nothing else changes.

## Wording to use

- "Every answer is traceable to the source." Every quote is checked word for word.
- "It tells you what it doesn't know." The "not covered" flag is a feature.
- "The client can decide with a clear picture."

## Claims to avoid

- "Multi-agent". There is one answer step and one labeling call.
- "Sales-ready". There is no CRM, SSO or compliance work. The sales version is a direction, not a product.
- "Understanding is measured". The votes are a proxy, not proof.
