"use client";

import { Button } from "@heroui/react";
import { HiDownload } from "react-icons/hi";

const APK_URL = "http://r2.piracy.cloud/app/321movies1.3.apk";

const DownloadButton: React.FC = () => {
  const handleClick = () => {
    // sendBeacon is guaranteed to complete even as the file download starts
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/download");
    }
  };

  return (
    <a href={APK_URL} download onClick={handleClick} className="shrink-0">
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
