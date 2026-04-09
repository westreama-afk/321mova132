"use client";

import { useDisclosure, useLocalStorage } from "@mantine/hooks";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  ScrollShadow,
} from "@heroui/react";
import { ADS_WARNING_STORAGE_KEY, IS_BROWSER } from "@/utils/constants";
import useSupabaseUser from "@/hooks/useSupabaseUser";
import { isPremiumUser } from "@/utils/billing/premium";

const AdsWarning: React.FC = () => {
  const { data: user, isLoading } = useSupabaseUser();
  const [seen, setSeen] = useLocalStorage<boolean>({
    key: ADS_WARNING_STORAGE_KEY,
    getInitialValueInEffect: false,
  });
  const [opened, handlers] = useDisclosure(!seen && IS_BROWSER);
  const isPremium = isPremiumUser(user);

  const handleSeen = () => {
    handlers.close();
    setSeen(true);
  };

  if (isLoading || isPremium || seen) return null;

  return (
    <Modal
      hideCloseButton
      isOpen={opened}
      placement="center"
      backdrop="blur"
      size="3xl"
      isDismissable={false}
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 text-center text-3xl uppercase">
          Before you watch!
        </ModalHeader>
        <ModalBody>
          <ScrollShadow hideScrollBar className="space-y-4">
            <p className="text-center">
              As our content is hosted by various third party providers, you may encounter pop up
              advertisements while streaming. Please be aware that we don't have control over the
              ads displayed and cannot be held responsible for their content or any issues they may
              cause. If an unexpected tab opens, close it and continue from this page. Do not
              download files or enter personal information in popups.
            </p>
          </ScrollShadow>
        </ModalBody>
        <ModalFooter className="justify-center">
          <Button color="primary" variant="shadow" onPress={handleSeen}>
            Okay, I understand
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default AdsWarning;
