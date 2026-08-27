import { NextRequest, NextResponse } from "next/server";
import { isAddress, getAddress } from "viem";

export const dynamic = "force-dynamic";

export interface ReportPayload {
  targetAddress: string;
  reporterAddress?: string;
  category: string;
  title: string;
  description: string;
  txHash?: string;
  evidenceType: "phishing" | "sweeper" | "honeypot" | "impersonation" | "exploit" | "custom";
}

// In-memory reports cache for hackathon runtime
const communityReportsStore: Record<string, ReportPayload[]> = {};

export async function POST(request: NextRequest) {
  try {
    const body: ReportPayload = await request.json();
    const { targetAddress, category, title, description, txHash, reporterAddress } = body;

    if (!targetAddress || !isAddress(targetAddress)) {
      return NextResponse.json(
        { error: "A valid Base address is required to submit a report." },
        { status: 400 },
      );
    }

    if (!title || !description) {
      return NextResponse.json(
        { error: "Report title and description are required." },
        { status: 400 },
      );
    }

    const normalized = getAddress(targetAddress).toLowerCase();

    if (!communityReportsStore[normalized]) {
      communityReportsStore[normalized] = [];
    }

    const newReport: ReportPayload = {
      targetAddress: normalized,
      reporterAddress: reporterAddress ? getAddress(reporterAddress) : "Anonymous User",
      category,
      title,
      description,
      txHash: txHash || undefined,
      evidenceType: body.evidenceType || "custom",
    };

    communityReportsStore[normalized].unshift(newReport);

    return NextResponse.json({
      success: true,
      reportCount: communityReportsStore[normalized].length,
      message: `Report recorded successfully for ${targetAddress}. Shield AI will factor this into future graph taint evaluations.`,
      report: newReport,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to submit report." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const addressParam = searchParams.get("address")?.toLowerCase();

  if (!addressParam) {
    return NextResponse.json({
      totalReportedAddresses: Object.keys(communityReportsStore).length,
    });
  }

  const reports = communityReportsStore[addressParam] || [];
  return NextResponse.json({
    address: addressParam,
    reportCount: reports.length,
    reports,
  });
}
