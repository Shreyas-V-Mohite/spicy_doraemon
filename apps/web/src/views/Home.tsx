import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppHeader from "../ui/AppHeader";
import Icon, { type IconName } from "../ui/Icon";

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "shield",
    title: "Answers you can trust",
    text: "Every answer comes from your professor's own lessons, with quotes checked word for word.",
  },
  {
    icon: "cube",
    title: "Molecules in 3D",
    text: "See the structure your professor is talking about, with the functional group highlighted.",
  },
  {
    icon: "pulse",
    title: "Speak up, quietly",
    text: "Let your professor know when you're lost or following, without raising your hand.",
  },
];

export default function Home() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  const clean = code.trim().toUpperCase();

  return (
    <>
      <AppHeader>
        <Link to="/professor" className="btn secondary sm">
          For instructors
        </Link>
      </AppHeader>
      <main className="container">
        <section className="home-hero">
          <div>
            <span className="eyebrow">Live chemistry classroom</span>
            <h1>
              Ask during lecture. <em>Get answers from your course.</em>
            </h1>
            <p className="lead">
              MolViz answers your questions from the professor's own material while the
              lecture is happening, and puts the molecules on your screen in 3D.
            </p>
          </div>

          <div className="card join-box">
            <h2>Join a class</h2>
            <p className="muted small" style={{ marginTop: 4 }}>
              Enter the 5-character code shown on your professor's screen.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (clean) navigate(`/s/${clean}`);
              }}
            >
              <label className="sr-only" htmlFor="join-code">
                Class code
              </label>
              <input
                id="join-code"
                className="code-input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
                placeholder="ABCDE"
                maxLength={5}
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
              <button type="submit" className="lg block" disabled={clean.length === 0}>
                Join class
                <Icon name="arrow-right" />
              </button>
            </form>
            <div className="divider">or</div>
            <p className="muted small" style={{ textAlign: "center" }}>
              Scan the QR code on the class screen with your phone camera.
            </p>
          </div>
        </section>

        <section className="features">
          {FEATURES.map((f) => (
            <div key={f.title} className="card feature">
              <div className="feature-icon">
                <Icon name={f.icon} size={18} />
              </div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
