import { TopDock } from "./components/TopDock";
import { EmptyWorkspace } from "./components/EmptyWorkspace";
import { BottomBar } from "./components/BottomBar";

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <TopDock />
      <main className="flex-1 overflow-hidden">
        <EmptyWorkspace />
      </main>
      <BottomBar />
    </div>
  );
}
