# Demo script

About three minutes. Everything below was exercised against the real services; the timings are what was measured, not promises.

## Before you start (10 minutes ahead)

```
npm run preflight       # every line a tick; fix what it says
npm run demo:seed       # demo course + sample lesson (safe to repeat)
```

- Services up: chemistry service, tunnel or hosted address, web app.
- **Laptop, in Chrome:** the professor page. Allow the **camera** and **microphone** when asked, then switch both off until the moment you need them. Use a headset or a quiet room, since the microphone hears everything.
- **Phone:** scan the QR code from the stage; this is student A. Open a second window or phone as student B.
- If the chemistry service is on a free host, open its `/health` once so it is awake.
- Have these ready to type or say (they are known to work):
  1. "Why is acetic acid acidic?"
  2. "What makes acetic acid an acid?"
  3. "What is the Krebs cycle?"
  4. Say aloud: "Remember for the exam: the pKa of acetic acid is about 4.76."
  5. "What pKa should I remember for acetic acid?"

## The three minutes

**1. The room (20 s).** Open the demo course, start a session ("Acids and alcohols"). The stage shows the join QR. Students scan it. *"A professor starts a class; students join with a code."*

**2. Questions answered from the lesson (40 s).**
- Student A asks question 1. In about 2–3 seconds the answer appears with word-for-word quotes labelled "From Functional groups › Carboxylic acids".
- Student B asks question 2. On the professor's page the two questions are **one card, "2 students"**, with a short label. Student B sees "1 classmate asked something similar".
- *"Answers come only from what the professor uploaded, and the server checks every quote against the lesson before a student sees it."*

**3. When the lesson doesn't cover it (20 s).** A student asks question 3. They see "Your lesson doesn't cover this. Your professor has been notified." On the professor's page that card jumps to the top, marked. *"The assistant says so instead of guessing, and the professor knows where the gaps are."*

**4. The molecule (40 s).** On the stage, load **acetic acid**. Chips appear for the groups RDKit found; click **Carboxylic acid** and the atoms light up. Click **Share molecule**: the phones show the same highlighted molecule. *"Claude never chooses atoms. RDKit finds them, and the server re-checks the highlight before it is shared."* Switch the style to space-filling to show the highlight holds.

**5. The lecture counts too (30 s).** Start transcribing and say line 4. Student A asks question 5. The answer quotes the lecture, labelled "Lecture … just now". *"What the professor says is searchable alongside the lesson."* (If the lecture contradicts the lesson, the answer follows the lesson and the professor is flagged.)

**6. Hands (30 s).** Click **Use hand gestures**. Your camera appears behind the molecule. Open and close your hand to resize, hold still and turn your hand to rotate, point to move it. Click **Present mode** to hide the private panels for screen-sharing. *"The camera view is what the room sees; students get the shared molecule."*

**7. Share an answer (10 s).** Back out of Present mode and click **Share answer with class** on a good answer. It appears on every phone, anonymous.

## What to say if something fails

| What happens | Why | What to do |
|---|---|---|
| A question stays on "Looking in your lesson…" | chemistry service or Claude slow | Wait up to 10 s: it falls back to the closest passage, shown as such. If the stage can't load molecules, run `npm run preflight` (usually the tunnel moved: `npm run tunnel`) |
| "Chemistry service is unreachable" on Load | tunnel or host is down | `npm run tunnel`, or wake the hosted service |
| Microphone shows "Problem" | Chrome can't reach its speech service | Skip step 5; say it is a Chrome limitation, not the product |
| Camera won't start | permission or no camera | Skip step 6 or use the mouse; the stage works without a camera |
| Hand gestures feel off | thresholds were tuned on synthetic hands | Move closer (40–80 cm), face the palm to the camera, add front light |
| A student gets an answer you didn't expect | quotes are verified, the summary is not | Show the quotes; they are the evidence. This is the honest limit of the design |

## Rehearse

Run the whole script twice with a stopwatch, including one deliberate failure (stop the tunnel and recover). Reset between runs by starting a new session; votes reset with the button on the professor page.
