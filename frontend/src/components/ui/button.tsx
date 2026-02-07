import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blood-600/30 focus-visible:ring-offset-2 focus-visible:ring-offset-sand-100 disabled:pointer-events-none disabled:opacity-40 cursor-pointer active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "bg-blood-600 text-sand-50 hover:bg-blood-500",
        destructive: "bg-blood-400 text-sand-50 hover:bg-blood-300",
        outline: "bg-sand-200 text-sand-800 hover:bg-sand-300",
        secondary: "bg-sand-200 text-sand-700 hover:bg-sand-300",
        ghost: "text-sand-700 hover:bg-sand-200",
        success: "bg-teal-400 text-sand-50 hover:bg-teal-500",
      },
      size: {
        default: "h-8 px-3.5 py-1",
        sm: "h-7 rounded-md px-2.5 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
