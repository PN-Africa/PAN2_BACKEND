import mongoose from "mongoose";

const generationSchema = new mongoose.Schema(
    {
        inputType: {
            type: String,
            enum: ["prompt", "url", "file"],
            required: true
        },

        input: {
            type: String
        },

        outputType: {
            type: String,
            enum: ["presentation", "webpage", "document"],
            required: true
        },

        status: {
            type: String,
            enum: ["pending", "processing", "completed", "failed"],
            default: "pending"
        },

        artifacts: { type: mongoose.Schema.Types.Mixed },
        outcome: { type: mongoose.Schema.Types.Mixed },

        generatedContent: {
            type: mongoose.Schema.Types.Mixed
        }
    },
    {
        timestamps: true
    }
);

const generateModel = mongoose.model("Generation", generationSchema);

export default generateModel;
