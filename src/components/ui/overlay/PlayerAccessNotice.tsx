"use client";

import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";

interface PlayerAccessNoticeProps {
  isOpen: boolean;
  onClose: () => void;
  missingRequirements: string[];
}

const PlayerAccessNotice: React.FC<PlayerAccessNoticeProps> = ({
  isOpen,
  onClose,
  missingRequirements,
}) => {
  if (!missingRequirements.length) return null;

  const isMissingAdblock = missingRequirements.some((item) =>
    item.toLowerCase().includes("ad blocker"),
  );

  return (
    <Modal isOpen={isOpen} placement="center" backdrop="blur" onClose={onClose}>
      <ModalContent>
        <ModalHeader className="text-center text-2xl">321 Player Requirements</ModalHeader>
        <ModalBody className="space-y-3">
          <p>321 Player is only available when all requirements are met:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li className={isMissingAdblock ? "text-warning-300" : "text-success-300"}>
              Disable your ad blocker for this site.
            </li>
          </ul>
          <p className="text-sm text-gray-300 mt-4">
            Running this service costs money in server costs and bandwidth. Ads help support these costs and keep the service free for everyone.
          </p>
          <p>You can still watch using other sources from the source selector.</p>
        </ModalBody>
        <ModalFooter className="justify-center">
          <Button color="primary" onPress={onClose}>
            Use Other Sources
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default PlayerAccessNotice;
