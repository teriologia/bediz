import { z } from "zod";
/** 9-slice kenar değerleri, kaynak texture üzerinde piksel cinsinden. */
export declare const SliceSchema: z.ZodObject<{
    left: z.ZodNumber;
    top: z.ZodNumber;
    right: z.ZodNumber;
    bottom: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    left: number;
    top: number;
    right: number;
    bottom: number;
}, {
    left: number;
    top: number;
    right: number;
    bottom: number;
}>;
export type Slice = z.infer<typeof SliceSchema>;
export declare const AssetSchema: z.ZodObject<{
    id: z.ZodString;
    path: z.ZodString;
    width: z.ZodNumber;
    height: z.ZodNumber;
    slice: z.ZodOptional<z.ZodObject<{
        left: z.ZodNumber;
        top: z.ZodNumber;
        right: z.ZodNumber;
        bottom: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        left: number;
        top: number;
        right: number;
        bottom: number;
    }, {
        left: number;
        top: number;
        right: number;
        bottom: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    path: string;
    id: string;
    width: number;
    height: number;
    slice?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
    } | undefined;
}, {
    path: string;
    id: string;
    width: number;
    height: number;
    slice?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
    } | undefined;
}>;
export type Asset = z.infer<typeof AssetSchema>;
/** Kenarlar texture'a sığmalı ve merkez bölge boş kalmamalı. */
export declare function validateSlice(s: Slice, w: number, h: number): void;
/**
 * Unreal UMG brush: DrawAs=Box, Margin normalize (0-1) ve sıra Left, Top, Right, Bottom.
 */
export declare function toUnrealBrush(a: Asset): {
    DrawAs: string;
    ImageSize: {
        X: number;
        Y: number;
    };
    Margin: {
        Left: number;
        Top: number;
        Right: number;
        Bottom: number;
    };
};
