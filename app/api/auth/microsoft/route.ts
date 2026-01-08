import { NextRequest, NextResponse } from 'next/server';

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI;

export async function GET(req: NextRequest) {
  try {
    // Get business ID from query parameter
    const searchParams = req.nextUrl.searchParams;
    const businessId = searchParams.get('businessId');
    
    if (!businessId) {
      return new NextResponse('Business ID is required', { status: 400 });
    }
    
    // Generate Microsoft OAuth URL with business ID in state
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${MICROSOFT_CLIENT_ID}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(MICROSOFT_REDIRECT_URI!)}&` +
      `scope=${encodeURIComponent('https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/User.Read offline_access')}&` +
      `state=${businessId}&` +
      `response_mode=query`;
    
    console.log('🔐 Redirecting to Microsoft OAuth for business:', businessId);
    
    // Redirect user to Microsoft login
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('OAuth init error:', error);
    return new NextResponse('Authentication failed', { status: 500 });
  }
}
