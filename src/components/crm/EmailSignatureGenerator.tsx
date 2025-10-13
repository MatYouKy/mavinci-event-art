'use client';

interface SignatureData {
  full_name: string;
  position?: string;
  phone?: string;
  email: string;
  avatar_url?: string;
  website?: string;
}

export function generateEmailSignature(data: SignatureData): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

  return `
<body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; margin: 0;">
  <table cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
      <td style="padding: 0 15px 15px 0; text-align: left;">
        <span style="font-family:'Open Sans', sans-serif; font-style: italic;">
          serdecznie pozdrawiam, <br />best regards,
        </span>
        <br />
      </td>
    </tr>
  </table>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left" width="100%" style="position: relative; max-width: 680px; overflow: hidden;" class="email-container">
    <tr>
      <td valign="top">
        <table role="presentation" cellpadding="0" cellspacing="0" align="center" width="100%" style="height: 100%; max-width:660px;">
          <tr>
            <td style="font-size:0;">
              ${data.avatar_url ? `
              <div style="display:inline-block; width:142px; vertical-align: top;" class="stack-column">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="142">
                  <tr>
                    <td dir="ltr" style="text-align: center;">
                      <img src="${data.avatar_url}"
                           width="142"
                           height="142"
                           alt="${data.full_name}"
                           class="center-on-narrow"
                           style="width: 142px; max-width: 142px; height: 142px; display: block; margin: 0 auto;">
                    </td>
                  </tr>
                </table>
              </div>
              ` : ''}

              <div style="display:inline-block; margin: 0 -2px; min-width:320px; max-width:490px; vertical-align: top; padding-left: ${data.avatar_url ? '15px' : '0'};" class="stack-column">
                <table dir="ltr" role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td valign="top" style="text-align: left; font-size: 10px; padding-top: 10px;">
                      <h1 style="line-height: 1.2; text-transform: uppercase; font-weight: 900; letter-spacing: 2px; color: inherit; margin: 0; font-size: 18px;">
                        ${data.full_name.split(' ')[0] || ''}
                      </h1>
                      <h1 style="color: #d2ba74; line-height: 1.2; text-transform: uppercase; font-weight: 900; letter-spacing: 2px; margin: 4px 0 8px 0; font-size: 18px;">
                        ${data.full_name.split(' ').slice(1).join(' ') || ''}
                      </h1>
                      ${data.position ? `
                      <p style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; margin: 0 0 12px 0; color: inherit; font-style: italic; letter-spacing: 1px; font-size: 11px;">
                        ${data.position}
                      </p>
                      ` : ''}
                    </td>
                  </tr>

                  <tr>
                    <td colspan="2">
                      <div style="height: 2px; width: 100%; background-color: #d2ba74; margin: 8px 0;"></div>
                    </td>
                  </tr>

                  ${data.phone ? `
                  <tr>
                    <td style="vertical-align:middle; padding: 4px 0;">
                      <table cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="vertical-align:middle; padding-right: 8px;">
                            <a href="tel:${data.phone.replace(/\s/g, '')}" style="text-decoration: none; display:block;">
                              <img style="height: 20px; width: 20px; display: block;" width="20" height="20" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA0klEQVR4nO3YMQ6CQBCF4T8xsbbxAHoOb+ExvIQn0MrGytrKE1hbU5AYAzFqMO4ib5JNNtnJ/MyQWQAAAAD+2UF6SHdJpdRe0kG6S/pI50gFAKBgV6mu1FlaRyoAAAU7qnWedpEKAEDBTmqdqX2kAgBQsLNa52obqQAAFOyi1plaRyoAAAW7qnWOtpEKAEDBbmqdoU2kAgBQsLtaZ2gdqQAAFOyh1uHbRCoAAAV7qnXo1pEKAEDB8p//VqXO/q7qEwFQ/sNYOo//jQAAAKpf9gKOIVg5sQrDygAAAABJRU5ErkJggg==" alt="Telefon">
                            </a>
                          </td>
                          <td style="vertical-align:middle;">
                            <a href="tel:${data.phone.replace(/\s/g, '')}" style="text-decoration: none; color: inherit; font-size: 13px; line-height: 20px; display:block; font-style: italic;">
                              ${data.phone}
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  ` : ''}

                  <tr>
                    <td style="vertical-align:middle; padding: 4px 0;">
                      <table cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="vertical-align:middle; padding-right: 8px;">
                            <a href="mailto:${data.email}" style="text-decoration: none; display:block;">
                              <img style="height: 20px; width: 20px; display: block;" width="20" height="20" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAuElEQVR4nO3YsQ2DMBRF0SsyAiOwQUZgA0ZgBDZgBEZgA0ZgBDYgI7AB6VAhJESK/Pwh3VO5iu7VT7YkAAAA/NoMHMAZPMADvMALPMEdPMAT3MANXMEFnMEJHMEBbMEGrMEKLMECzMEMTMEETMAYjMEIDMAA9EEP9EAXdEEHtEELNEEDVEEF5EEO5EAGpEEKJEECxEEMREEExEAEhEEIBEEAeL8fvN73Xb2v9f5B8A+Gf1D8w+MfJgAAAKQ/9gECRhJ2kPOm0wAAAABJRU5ErkJggg==" alt="Email">
                            </a>
                          </td>
                          <td style="vertical-align:middle;">
                            <a href="mailto:${data.email}" style="text-decoration: none; color: inherit; font-size: 13px; line-height: 20px; display:block; font-style: italic;">
                              ${data.email}
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td>
                      <div style="height: 8px;"></div>
                    </td>
                  </tr>

                  <tr>
                    <td>
                      <table cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding-right: 8px;">
                            <a href="${data.website || 'https://mavinci.pl'}" target="_blank" style="display:block;">
                              <img width="24" height="24" style="display: block;" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABcElEQVR4nO2YsUoDQRCGP0EQC7GwEATBQhsfwMZC8AV8AQtBsBB8AB/AxkKwEHwAC0GwEARBsLCwEAQL0UKwECwEC0GwkF0YYThud29v725v4YdhYXd25r/Z2dnZXSgUCmSgBqyAG/AFfAL3wAo4BypZE1gA7kCUgUcgB94TeAZOgSowDYwD1fhzGvgEXoC5LAnUgG+HuBd4BY6APeAPeAQugXdg1zN2FeiQhQxeXPuAuUSfXeAWeANGM5AZj8n0HH3qwF0qnScXwJCjzxBwmYU6v8nMOvo0UpFPx+Q4SpUrgQYw4ugzmIqeOPI4jkPJzKejEpFJZzyVfXCk+S/wAEw6+kymEkk1MpGOQslsOX7dVjrfPiYpRdscfbaB77SyG4605xw2qpPyvIPkGegDtoFO/GnH39ucsvEAnAFjifONxefz+H5pfRcCC0p/QS1zcjz0p6xTofDy/8n+haqYo8U0S+Bo+2XQylk/qNnaHQqFQoH/wxfvZJ5PsU6rBAAAAABJRU5ErkJggg==" alt="Website">
                            </a>
                          </td>
                          <td style="padding-right: 8px;">
                            <a href="https://www.facebook.com/mavinci" target="_blank" style="display:block;">
                              <img width="24" height="24" style="display: block;" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABOElEQVR4nO2YsUoDQRCGP0EQCy0sRLCwEHwBGwvBF/AFLATBQvABfAAbC8FC8AEsBMFCEATBwsJCECxEC8FCsBAsBAvBQnZhhOF0726v9nYXfhgWdnf+m53Z2dldKBQKBQLQBM6BZ+ADuAMugAFQj5vAIvAKRAlegeE4RaAFfFniPuAFGAX+gDfgFHgD9j1ja0CHOAiMOuKdwDPQD/wCL8AJ8A7seMZWgS/iIOBw7AEeUvW5Ah6BwRhkhoCXtNbZK1MMUfaaA+4TbaGbQJPLyacjEpEp13guGiLyYcjzX+ADmHP0mUtFz+wy86E4lsx2YK5E5NPxG4dkKp3f5JCJO48NybUcifSno+KRSV1HZdqopGRmHP+uVqpvH0lKctvRpwW8p+3dx6Tl2G5Qb+VPudA/peqkxv9xv3L/B1UoFArEwi9P93tFVOe40AAAAABJRU5ErkJggg==" alt="Facebook">
                            </a>
                          </td>
                          <td style="padding-right: 8px;">
                            <a href="https://linkedin.com/company/mavinci-event-art" target="_blank" style="display:block;">
                              <img width="24" height="24" style="display: block;" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABXElEQVR4nO2YPUvEQBCGHxHB0kILC1GwEPwHVhaCv8Bf4I8QwULwB/gDbCwEC8EfYCEIFoIgCFYWFoJgoVoIFoKFYCFYyC6MMJxu726z2d2FfWBYLu/uzL6TyWQ3FAqFQiEfKkAbmAG/wAdwB0wBNaAcdwC6wBsQZXgFeuIi0AL+HPEu4Bnw+QXegEvgDdjzjK0Cn/gQcDj2Ag8kq8sV8Aj4YiLQ4Hlx3UsmbpN15gqYTrRl3gT8ynLriETEy0xHZEok4sOQ57/AB9DsGNtMRS/sMstBZy5v9pjLm30mYCIj0e/oz4ckc+S7BkJXOjUL06HwyORfp4Yks+m5IdlVSTq/6bmO3HpsKK4VJdLv6K+IJN3/61eUI5eGo08L+Ejbuw9JW45tEHXOn3Khf8pUSW0+41F1a1YUCv+kqkMt0ZFSn09Cq6Ti/xhZ3f9AlUKhUIj7xS86Vq3ivPmZhgAAAABJRU5ErkJggg==" alt="LinkedIn">
                            </a>
                          </td>
                          <td style="padding-right: 8px;">
                            <a href="https://www.instagram.com/mavinci_event_art" target="_blank" style="display:block;">
                              <img width="24" height="24" style="display: block;" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAADpklEQVR4nO2ZTYhVVRjHf+M4zoyjZH4UmVSU1KJNEC2KokURBEELCaJFEC1aRItokUQLiRYSLYIgWrSIFkELiRZBRAuJFhItJFoEQQuJFhItJFr0cOCBw3Dvuffe9773ztw78Icze8/H+T/nf77uuTAwMDAwMPAfYAnwIvAd8DfwB3AIeBtYBhRxJrAG+Bn4F5iMsN+BrcBZ/UacA+wH/gYmGth+YJ1TgAuBQyFpn9sBrO4qgNuBY6HmTmAfsBVYHVj2Xa+0nZ8AfwLrswC4CvglZHgXcG+N/ixgU0gzR4DbuwqwOtTQPcD0SN0FwJ6QPu4FOgc4DzgR2H9bQ/nrA23sBKa1DcCTIfGdNtqvC+jmULuAKW0CeC3IzhZgSsY+bA3a3dYGgAKwI8h6nwP9dMeLYTtwcasAFofO+FYL+ukOZ/2pRgEKwEcheZsNjAD3A9cCsyuUXwrMD65NrwTlfxxpeytwRt0AjwWadbGjwPMhsceArcD9wDkpbeYCW4DHK+hzS6TtNbUAXO7SYQ9wVk5B1oSaf61k/14gvj2VKqkB3gntv1OT3Kt99bglAPx0dHJV+/cGXv9SpQ8zKjT+ey2yd4eEPVLz/tcFsp+IlN0StLs5qe1sygP4OSfZ1aEjPxm0f2/Q9k9J2s4GQBnvuUZrgVHgbW/tRrr07q8ibW8JAB5xfboOeBi4Erg+pfxG17/rgTeAF0I7/2RS29kBuMVxeqvL8qSt0/cF9ucBK4BngLuAa0J/bwY+COzHEtvOBsDKwP+/KuO83aH8soDdX7L/YsI5XlXD+V1Z4zlOC8QLgAeBC2qUf8sT8VlgQaR8fshGk9rOBsDyQL2n5QjweNDW5S5dLpfYuFej31mT7LTKfQauqkF2mSf7YwP9WB6U/y5p3LUC2OnJbqxBdrYnW/g/KfubJ/t9DeOuFYDMuxC4L+PQkPxSz9Ue6bkvO0rfAnkAOJ5D+W896WWVvrsION7HmKkF4KhT4OeM5W/zZI9kHHfTJfUAXPVkj2QsP+rJrurjuGsOoBDYqFU1fqM1+oZz/vFIudzfd8q0vzZ0nq4uyy1dqrEduCMQ8zIgP7csBb52DttBoLXLgROhaHgKmHG0nfVXBVOqN+2+lfHV2ZuuL9/WGHd54P3d+T6Pu17JEK/n1puxX1RGXwk/JsXbj7oe7WS+0JLBnAB8AFTK6Mn0Lc2N0ZVIP6a5sd7o6vsoKOJMSq5kHXnV/aHzH5h0/gMDAwMDDPAPg2f8N0evxikAAAAASUVORK5CYII=" alt="Instagram">
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <table cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 660px;">
    <tr>
      <td>
        <div style="height: 2px; width: 100%; background-color: #d2ba74; margin: 15px 0 10px 0;"></div>
      </td>
    </tr>
    <tr>
      <td style="font-size: 12px; text-align: left; color: inherit;">
        <p style="margin: 2px 0; font-size: 14px; font-weight: 600;">Mavinci sp. z o.o.</p>
        <p style="margin: 2px 0;">ul. Marcina Kasprzaka 15/66, 10-057 Olsztyn</p>
        <p style="margin: 2px 0;">KRS: 0001152576</p>
        <p style="margin: 2px 0;">NIP: 7394011583</p>
        <p style="margin: 2px 0;">REGON: 540783544</p>
      </td>
    </tr>
  </table>
</body>
  `.trim();
}

export function EmailSignaturePreview({ data }: { data: SignatureData }) {
  const html = generateEmailSignature(data);

  return (
    <div className="bg-white rounded-lg p-6 overflow-auto">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
