import { Route, Routes } from "react-router-dom";
import { StoreContext } from "./store/sessionStore";
import { useConvexStore } from "./store/convexStore";
import ErrorBoundary from "./ErrorBoundary";
import Home from "./views/Home";
import ProfessorStart from "./views/ProfessorStart";
import Professor from "./views/Professor";
import Student from "./views/Student";
import Presentation from "./views/Presentation";

export default function App() {
  const store = useConvexStore();
  return (
    <StoreContext.Provider value={store}>
      <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/professor" element={<ProfessorStart />} />
        <Route path="/professor/:code" element={<Professor />} />
        <Route path="/s/:code" element={<Student />} />
        <Route path="/present/:code" element={<Presentation />} />
        <Route path="*" element={<Home />} />
      </Routes>
      </ErrorBoundary>
    </StoreContext.Provider>
  );
}
