import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { StoreContext } from "./store/sessionStore";
import { useConvexStore } from "./store/convexStore";
import ErrorBoundary from "./ErrorBoundary";
import Home from "./views/Home";
import ProfessorStart from "./views/ProfessorStart";
import CoursePage from "./views/CoursePage";
import Professor from "./views/Professor";
import Student from "./views/Student";

export default function App() {
  const store = useConvexStore();
  return (
    <StoreContext.Provider value={store}>
      <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/professor" element={<ProfessorStart />} />
        <Route path="/professor/course/:courseId" element={<CoursePage />} />
        <Route path="/professor/:code" element={<Professor />} />
        <Route path="/s/:code" element={<Student />} />
        <Route path="/present/:code" element={<PresentRedirect />} />
        <Route path="*" element={<Home />} />
      </Routes>
      </ErrorBoundary>
    </StoreContext.Provider>
  );
}

// The presentation view is now Present mode on the professor page.
function PresentRedirect() {
  const { code = "" } = useParams();
  return <Navigate to={`/professor/${code}`} replace />;
}
