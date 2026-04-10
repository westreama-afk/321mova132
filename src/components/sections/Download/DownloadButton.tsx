"use client";

import { Button } from "@heroui/react";
import { HiDownload } from "react-icons/hi";

const DownloadButton: React.FC = () => {
  return (
    <a href="/api/download" className="shrink-0">
      <Button
        color="primary"
        size="lg"
        startContent={<HiDownload className="h-5 w-5" />}
        className="font-semibold"
      >
        Download APK
      </Button>
    </a>
  );
};

export default DownloadButton;
