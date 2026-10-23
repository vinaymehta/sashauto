"use client";

import Bugsnag from "@bugsnag/js";
import BugsnagPluginReact from "@bugsnag/plugin-react";
import React, { type ReactNode } from "react";

// Error tracking with Bugsnag in the browser: errors in the pages (and a page that crashes while rendering) are reported
// when NEXT_PUBLIC_BUGSNAG_API_KEY is set (frontend .env, at build time); without it nothing is sent. Only production
// builds report.
const apiKey = process.env.NEXT_PUBLIC_BUGSNAG_API_KEY;

if (apiKey && typeof window !== "undefined" && !Bugsnag.isStarted()) {
  Bugsnag.start({
    apiKey,
    plugins: [new BugsnagPluginReact()],
    releaseStage: process.env.NEXT_PUBLIC_BUGSNAG_RELEASE_STAGE || process.env.NODE_ENV,
    enabledReleaseStages: ["production"],
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || undefined,
  });
}

const ErrorBoundary = apiKey && typeof window !== "undefined" ? Bugsnag.getPlugin("react")?.createErrorBoundary(React) : undefined;

export function BugsnagBoundary({ children }: { children: ReactNode }) {
  return ErrorBoundary ? <ErrorBoundary>{children}</ErrorBoundary> : <>{children}</>;
}
