"use client";

import useBreakpoints from "@/hooks/useBreakpoints";
import { Accordion, AccordionItem } from "@heroui/react";

const FAQS = [
  {
    title: "What is 321movies?",
    description:
      "Just like other streaming sites, 321movies helps you quickly access TV shows and movies without spending hours searching.",
  },
  {
    title: "So what do we actually do?",
    description:
      "We do not host copyright-protected media files on our own servers. Any linked content is provided by third-party websites. This is a promotional and educational project.",
  },
  {
    title: "I cannot watch video because of ads",
    description: (
      <p>
        We are sorry about that. Ads are served by third-party providers and are outside our
        control. If popups appear, close them and return to the player. Do not download files or
        enter personal/payment information in popup windows.
      </p>
    ),
  },
  {
    title: "Streaming speed is slow or videos do not play",
    description:
      "On the episode page, press play first. If it still fails, switch to another available server (for example, Vidlink or VidSrc). Trying a different server usually resolves playback issues.",
  },
  {
    title: "I want to download video",
    description:
      "Since we do not store files, there is no direct download feature here. Content references are collected from third-party sources across the web.",
  },
  {
    title: "Is it safe to stream on this website?",
    description:
      "Streaming is generally safer than downloading/uploading copyrighted files. Avoid downloading and redistributing content, as that may violate laws in your region.",
  },
];

const FAQ = () => {
  const { mobile } = useBreakpoints();

  return (
    <Accordion variant="splitted" isCompact={mobile}>
      {FAQS.map(({ title, description }) => (
        <AccordionItem key={title} aria-label={title} title={title}>
          {description}
        </AccordionItem>
      ))}
    </Accordion>
  );
};

export default FAQ;
