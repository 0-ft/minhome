import type { ReactNode } from "react";

declare module "react" {
  type ViewTransitionClass = string | Record<string, string>;

  interface ViewTransitionProps {
    children: ReactNode;
    name?: string | Record<string, string>;
    enter?: ViewTransitionClass;
    exit?: ViewTransitionClass;
    update?: ViewTransitionClass;
    share?: ViewTransitionClass;
    default?: ViewTransitionClass;
  }

  export const ViewTransition: (props: ViewTransitionProps) => ReactNode;
}
