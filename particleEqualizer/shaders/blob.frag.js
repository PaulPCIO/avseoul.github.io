var blob_frag = 
`

varying float v_noise;

uniform float u_audio_high;
uniform float u_audio_mid;
uniform float u_audio_bass;
uniform float u_audio_level;
uniform float u_audio_history;

vec3 norm(in vec3 _v){
  return length(_v) > .0 ? normalize(_v) : vec3(0.);
}

#if defined(IS_POINTS)
  uniform sampler2D tex_sprite;
#endif

#if defined(IS_PBR) && defined(HAS_CUBEMAP)
  uniform samplerCube cubemap;

  uniform sampler2D tex_normal;
  uniform sampler2D tex_roughness;
  uniform sampler2D tex_metallic;
  
  uniform float u_normal;
  uniform float u_roughness;
  uniform float u_metallic;
  uniform float u_exposure;
  uniform float u_gamma;

  varying vec3 v_world_normal;
  varying vec3 v_object_pos;
  varying vec3 v_eye_pos;
  varying vec3 v_pos;
  varying vec3 v_normal;
  varying vec3 v_world_pos;
  varying vec2 v_uv;

  #define PI 3.1415926535897932384626433832795

  // Filmic tonemapping from
  // http://filmicgames.com/archives/75
  const float A = 0.15;
  const float B = 0.50;
  const float C = 0.10;
  const float D = 0.20;
  const float E = 0.02;
  const float F = 0.30;

  vec3 Uncharted2Tonemap( vec3 x )
  {
    return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;
  }

  // https://www.unrealengine.com/blog/physically-based-shading-on-mobile
  vec3 EnvBRDFApprox( vec3 SpecularColor, float Roughness, float NoV )
  {
    const vec4 c0 = vec4( -1, -0.0275, -0.572, 0.022 );
    const vec4 c1 = vec4( 1, 0.0425, 1.04, -0.04 );
    vec4 r = Roughness * c0 + c1;
    float a004 = min( r.x * r.x, exp2( -9.28 * NoV ) ) * r.x + r.y;
    vec2 AB = vec2( -1.04, 1.04 ) * a004 + r.zw;
    return SpecularColor * AB.x + AB.y;
  }


  // http://the-witness.net/news/2012/02/seamless-cube-map-filtering/
  vec3 fix_cube_lookup( vec3 v, float cube_size, float lod ) {
    float M = max(max(abs(v.x), abs(v.y)), abs(v.z));
    float scale = 1. - exp2(lod) / cube_size;
    if (abs(v.x) != M) v.x *= scale;
    if (abs(v.y) != M) v.y *= scale;
    if (abs(v.z) != M) v.z *= scale;
    return v;
  }

  // Normal Blending
  // Source adapted from http://blog.selfshadow.com/publications/blending-in-detail/
  vec3 blendNormalsUnity( vec3 baseNormal, vec3 detailsNormal )
  {
      vec3 n1 = baseNormal;
      vec3 n2 = detailsNormal;
      mat3 nBasis = mat3(
          vec3(n1.z, n1.y, -n1.x), // +90 degree rotation around y axis
          vec3(n1.x, n1.z, -n1.y), // -90 degree rotation around x axis
          vec3(n1.x, n1.y,  n1.z));
      return norm(n2.x*nBasis[0] + n2.y*nBasis[1] + n2.z*nBasis[2]);
  }
  vec3 blendNormals( vec3 n1, vec3 n2 )
  {
    return blendNormalsUnity( n1, n2 );
  }
#endif

#if defined(HAS_SHADOW)
  uniform sampler2D u_shadow_map;
  uniform vec3 u_light_pos;
  uniform bool u_debug_shadow;
  varying vec4 v_shadow_coord;

  float sample_shadow( vec4 sc )
  {
    float s = 1./1024.;

    vec2 unproj2D = vec2 (sc.s / sc.q,
                          sc.t / sc.q);
    
    float shadow = 0.0;
    shadow += texture2D( u_shadow_map, unproj2D + vec2(-s,-s) ).r;
    shadow += texture2D( u_shadow_map, unproj2D + vec2(-s, 0.) ).r;
    shadow += texture2D( u_shadow_map, unproj2D + vec2(-s, s) ).r;
    shadow += texture2D( u_shadow_map, unproj2D + vec2( 0.,-s) ).r;
    shadow += texture2D( u_shadow_map, unproj2D + vec2( 0., 0.) ).r;
    shadow += texture2D( u_shadow_map, unproj2D + vec2( 0., s) ).r;
    shadow += texture2D( u_shadow_map, unproj2D + vec2( s,-s) ).r;
    shadow += texture2D( u_shadow_map, unproj2D + vec2( s, 0.) ).r;
    shadow += texture2D( u_shadow_map, unproj2D + vec2( s, s) ).r;
    
    return shadow/9.0;;
  }
#endif


void main(){
  float m_noise = v_noise;
  float m_noise_inv = 1.-v_noise;

  vec3 m_diffuse = vec3(0.);
  m_diffuse.r += m_noise_inv + m_noise;
  m_diffuse.g += m_noise*1.5;
  //m_diffuse.b += m_noise;
  m_diffuse -= pow(abs(1.-m_noise), 4.)*.95; //<- darken peak
  m_diffuse = clamp(m_diffuse, vec3(0.), vec3(2.));

  vec3 m_col = m_diffuse;


#if defined(IS_SHADOW)
  gl_FragColor = vec4(m_col, 1.);

  return;
#endif


#if defined(IS_PBR) && defined(HAS_CUBEMAP)
  vec3 N = norm( v_world_normal );

  // blend with PBR's
  N = blendNormals( N, texture2D( tex_normal, v_uv ).xyz );

  vec3 V = norm( v_eye_pos );

  // fresnel 
  float m_fresnel = 1. + dot(norm(v_world_pos - v_eye_pos), v_world_normal);

#if defined(HAS_SHADOW)
  // Light direction
  vec3  L = norm( u_light_pos - v_pos.xyz );
  // Surface reflection vector
  vec3  R = norm( -reflect( L, N ) );
#endif
  
  // sample the roughness and metallic textures
  float roughnessMask = texture2D( tex_roughness, v_uv ).r;
  float metallicMask  = texture2D( tex_metallic, v_uv ).r;
  
  // deduce the diffuse and specular color from the baseColor and how metallic the material is
  vec3 m_specular_col = m_diffuse * 4.;
  vec3 m_diffuse_col = m_diffuse;
  vec3 diffuseColor = m_diffuse_col - m_diffuse_col * u_metallic * metallicMask;
  vec3 specularColor  = mix( vec3( 0.08 * m_specular_col ), m_diffuse_col, u_metallic * metallicMask );
  
  // sample the pre-filtered cubemap at the corresponding mipmap level
  int numMips     = 6;
  float mip     = float(numMips) - 1. + log2( u_roughness * roughnessMask );
  vec3 lookup     = -reflect( V, N );
  vec3 radiance   = pow( textureCube( cubemap, fix_cube_lookup( lookup, 2048., mip ) ).rgb, vec3( 2.2 ) );
  vec3 irradiance   = pow( textureCube( cubemap, fix_cube_lookup( N, 2048., 0. ) ).rgb, vec3( 2.2 ) );

  // get the approximate reflectance
  float NoV     = saturate( dot( N, V ) );
  vec3 reflectance  = EnvBRDFApprox( specularColor, pow( abs(u_roughness * roughnessMask), 4.0 ), NoV );

  // combine the specular IBL and the BRDF
  vec3 diffuse  = diffuseColor * radiance;
  vec3 specular = radiance * reflectance;
  m_col = diffuse + specular;

#if defined(HAS_SHADOW)
  // from light source
  vec3 m_light_diffuse_color = m_diffuse;
  vec3 m_light_specular_color = m_diffuse * 4.;
  float m_light_diffuse_intensity = 5.;
  float m_light_specular_intensity = 4.;
  float m_light_diffuse_pow = 14.;
  float m_light_specular_pow = 15.;
  
  // Diffuse factor
  float NdotL = max( dot( N, L ), 0.0 );
  vec3  D = vec3( NdotL );
  D = pow(abs(D), vec3(m_light_diffuse_pow));
  
  D *= m_light_diffuse_color * m_light_diffuse_intensity;
  
  // Specular factor
  vec3  S = pow( max( dot( R, V ), 0.0 ), 50.0 ) * vec3(1.);
  S = pow(abs(S), vec3(m_light_specular_pow));
  
  S *= m_light_specular_color * m_light_specular_intensity;

  m_col += (D + S);

  // cal shadow 
  float m_shadow = 1.;
  vec4 m_shadow_coord = v_shadow_coord;
  // m_shadow_coord.z += .0003; // <- bias

  m_shadow = sample_shadow(m_shadow_coord);
  m_col *= (m_shadow + m_col*.2 + m_diffuse*.5);
#endif

  // add noise diffuse
  m_col += pow(abs(m_diffuse), vec3(10.))*3.;

  // fresnel
   // m_col.r -= pow(abs(m_fresnel), 3.) * 2.;
  
  // apply the tone-mapping
  m_col       = Uncharted2Tonemap( m_col * u_exposure );
  // white balance
  m_col       = m_col * ( 1. / Uncharted2Tonemap( vec3( 20. ) ) );
  
  // gamma correction
  m_col       = pow( abs(m_col), vec3( 1. / u_gamma ) );
#endif




#if defined(IS_WIRE) || defined(IS_POINTS)
  m_col.b -= m_col.g;
  
  // inner ziggle
  m_col *= .4 * pow(abs(m_noise), 6.);
  
  // outter ziggle
  m_col.rg += .2 * pow(abs(m_noise_inv), 4.);
  m_col.g *= .5;

  // treble burn
  m_col += pow(abs(u_audio_high), 3.) * 1.;

#endif 
  gl_FragColor = vec4(m_col, 1.);
  
#if defined(HAS_SHADOW)
  if(u_debug_shadow)
    gl_FragColor = vec4(vec3(m_shadow), 1.);
#endif




#if defined(IS_POINTS)
  gl_FragColor *= texture2D(tex_sprite, gl_PointCoord);

  vec3 m_point_col = gl_FragColor.rgb;
  m_point_col.g += m_point_col.g;
  gl_FragColor.rgb = m_point_col;
#endif


#if defined(IS_POP) || defined(IS_POP_OUT)
  gl_FragColor.r = gl_FragColor.g = gl_FragColor.b;
  gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(1.2));
  
  gl_FragColor.rgb *= 10.;

  #if defined(IS_POINTS) && defined(IS_POP)
    gl_FragColor.rgb = 1.-gl_FragColor.rgb;
  #endif
  #if defined(IS_WIRE)
    gl_FragColor.rgb *= .5;

    #if defined(IS_POP_OUT)
      // gl_FragColor.rgb = (1.-gl_FragColor.rgb)*.1;
      gl_FragColor.rgb *= .2;
    #endif
  #endif

  // on&off
  gl_FragColor.rgb *= u_audio_level;

#endif

}
`