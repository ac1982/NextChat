"use client";

import { Analytics } from "@vercel/analytics/react";
import { getClientConfig } from "./config/client";
import dynamic from "next/dynamic";

const Home = dynamic(
  () => import("./components/home").then((mod) => ({ default: mod.Home })),
  {
    ssr: false,
  },
);

const clientConfig = getClientConfig();

export default function App() {
  return (
    <>
      <Home />
      <Analytics />
    </>
  );
}
