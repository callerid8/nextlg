"use client";
import { useState, useMemo } from "react";

import ThemeToggle from "@/components/ThemeToggle";
import NetworkTest from "@/components/NetworkTest";
import Speedtest from "@/components/SpeedTest";
import TestToggle from "@/components/TestToggle";
import Link from "next/link";
import Image from 'next/image'

export default function LookingGlass() {
  const [showSpeedTest, setShowSpeedTest] = useState<boolean>(false);
  const companyName = process.env.NEXT_PUBLIC_COMPANY_NAME || "Looking Glass";
  const logoURL = process.env.NEXT_PUBLIC_LOGO_URL || "";
  const logoWidth = parseInt(process.env.NEXT_PUBLIC_LOGO_WIDTH || "250", 10);
  const logoHeight = parseInt(process.env.NEXT_PUBLIC_LOGO_HEIGHT || "100", 10);
  const homePath = process.env.NEXT_PUBLIC_HOME_URL || "/";

  // Memoize the logo component
  const Logo = useMemo(() => {
    return logoURL === "" ? (
      companyName
    ) : (
      <Image alt={companyName} width={logoWidth} height={logoHeight} src={logoURL} />
    );
  }, [companyName, logoURL, logoWidth, logoHeight]);

  return (
    <main className="flex min-h-screen flex-col items-center p-8 space-y-8">
      <div className="flex max-w-md lg:max-w-3xl w-full content-center">
        <h1 className="flex-auto text-2xl md:text-3xl font-bold">
          <Link href={homePath}>
            {Logo}
          </Link>
        </h1>
        <TestToggle onToggle={setShowSpeedTest} />
        <ThemeToggle />
      </div>
      {showSpeedTest ? <Speedtest /> : <NetworkTest />}
    </main>
  );
}
