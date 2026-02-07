import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/50 focus-visible:ring-offset-2 focus-visible:ring-offset-blood-400 disabled:pointer-events-none disabled:opacity-40 cursor-pointer active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "bg-sand-50 text-blood-600 hover:bg-sand-200",
        destructive: "bg-blood-700 text-blood-100 hover:bg-blood-800",
        outline: "bg-blood-500/40 text-blood-100 hover:bg-blood-500/60",
        secondary: "bg-blood-500/40 text-blood-100 hover:bg-blood-600/50",
        ghost: "text-blood-100 hover:bg-blood-500/40",
        success: "bg-teal-400 text-teal-900 hover:bg-teal-300",
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
