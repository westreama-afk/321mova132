import { Button } from "@heroui/react";
import { HiDownload } from "react-icons/hi";

const APK_URL = "http://r2.piracy.cloud/app/321movies1.3.apk";

const DownloadButton: React.FC = () => (
  <a href={APK_URL} download className="shrink-0">
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

export default DownloadButton;
