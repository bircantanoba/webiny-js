import React from "react";
import Grid from "./Grid";
import { PbRenderElementPlugin } from "@webiny/app-page-builder/types";

export default (): PbRenderElementPlugin => {
    return {
        type: "pb-render-page-element",
        name: "pb-render-page-element-grid",
        elementType: "grid",
        render(props) {
            return <Grid {...props} />;
        }
    };
};
