import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const businessId = searchParams.get('businessId');
    
    if (!businessId) {
      return new NextResponse('Business ID is required', { status: 400 });
    }
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI!)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email')}&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `state=${businessId}`;
    
    console.log('🔐 Redirecting to Google OAuth for business:', businessId);
    
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('OAuth init error:', error);
    return new NextResponse('Authentication failed', { status: 500 });
  }
}
