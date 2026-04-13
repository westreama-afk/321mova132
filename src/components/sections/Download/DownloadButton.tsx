import { Button } from "@heroui/react";
import { HiDownload } from "react-icons/hi";

const APK_URL = "https://apkpure.com/p/com.mova321";

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
