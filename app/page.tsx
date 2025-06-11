import { Analytics } from "@vercel/analytics/react";
import { getServerSideConfig } from "./config/server";
import dynamic from "next/dynamic";

const Home = dynamic(
  () => import("./components/home").then((mod) => ({ default: mod.Home })),
  {
    ssr: false,
  },
);

const serverConfig = getServerSideConfig();

export default async function App() {
  return (
    <>
      <Home />
      {serverConfig?.isVercel && (
        <>
          <Analytics />
        </>
      )}
    </>
  );
}
