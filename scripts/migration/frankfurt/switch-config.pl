#!/usr/bin/env perl
# Zamiana STAREGO projektu Supabase na NOWY w plikach konfiguracyjnych (wywołuje 12-switch-config.sh, lokalnie i na serwerze).
# Adres <stary>.supabase.co → <nowy>.supabase.co; klucze JWT starego projektu rozpoznawane po zawartości (ref + role)
# → klucz anon / service_role nowego projektu. Wartości kluczy nigdy nie są wypisywane.
#   perl switch-config.pl check                     — sprawdza klucze nowego projektu (stdin: anon, service_role)
#   perl switch-config.pl apply|dry PLIK…           — zmienia / tylko liczy (stdin: anon, service_role)
#   perl switch-config.pl apply|dry|restore --find KATALOG
#   perl switch-config.pl restore PLIK…             — przywraca pliki z kopii <plik>.przed-frankfurtem
#   pm2 jlist | perl switch-config.pl pm2           — które procesy PM2 mają jeszcze stary projekt
use strict;
use warnings;
use MIME::Base64 qw(decode_base64);
use JSON::PP qw(decode_json);
use File::Find qw(find);
use File::Copy qw(copy);

my $OLD = $ENV{OLD_REF} or die "Brak OLD_REF\n";
my $NEW = $ENV{NEW_REF} // '';
my $mode = shift(@ARGV) // die "Brak trybu\n";
my $BACKUP = '.przed-frankfurtem';
my $JWT = qr/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

sub claims {
  my @part = split /\./, shift;
  return undef unless @part == 3;
  (my $b = $part[1]) =~ tr{-_}{+/};
  $b .= '=' x ((4 - length($b) % 4) % 4);
  my $json = eval { decode_json(decode_base64($b)) };
  return ref($json) eq 'HASH' ? $json : undef;
}
sub old_jwt_role { my $c = claims(shift); return ($c && ($c->{ref} // '') eq $OLD) ? ($c->{role} // '?') : undef; }

if ($mode eq 'pm2') {
  local $/;
  my $raw = <STDIN> // '[]';
  my $list = eval { decode_json($raw) } || [];
  for my $p (@$list) {
    my $text = JSON::PP->new->canonical->encode($p->{pm2_env} || {});
    my $hits = () = $text =~ /\Q$OLD\E/g;
    for my $t ($text =~ /($JWT)/g) { $hits++ if defined old_jwt_role($t); }
    printf "  %-30s %s\n", $p->{name} // '?', $hits ? 'STARY projekt w konfiguracji procesu' : 'ok';
  }
  exit 0;
}

my ($anon, $service) = ('', '');
if ($mode =~ /^(check|apply|dry)$/) {
  $anon = <STDIN> // ''; $service = <STDIN> // '';
  s/[\r\n]+$// for $anon, $service;
}

if ($mode eq 'check') {
  my %key = (anon => $anon, service_role => $service);
  for my $role (qw(anon service_role)) {
    my $c = claims($key{$role});
    die "Klucz $role nie jest kluczem JWT (eyJ…). Nowy projekt → Project Settings → API Keys → Legacy API Keys → $role.\n" unless $c;
    die "Klucz $role jest z innego projektu (" . ($c->{ref} // '?') . "), potrzebny klucz projektu $NEW.\n" unless ($c->{ref} // '') eq $NEW;
    die "W polu $role wklejono klucz roli „" . ($c->{role} // '?') . "”.\n" unless ($c->{role} // '') eq $role;
  }
  print "Klucze nowego projektu ($NEW): anon i service_role — poprawne.\n";
  exit 0;
}

die "Nieznany tryb: $mode\n" unless $mode =~ /^(apply|dry|restore)$/;

my @files;
if (@ARGV && $ARGV[0] eq '--find') {
  my $root = $ARGV[1] // die "Brak katalogu\n";
  find(sub {
    if (-d $_ && /^(node_modules|\.next|\.next-build|standalone|logs|\.git|\.cache|\.npm|\.yarn)$/) { $File::Find::prune = 1; return; }
    return unless -f $_;
    return if /\Q$BACKUP\E$|\.bak|\.tmp$|^\.env\.before-|\.example$|frankfurt-tmp/;
    push @files, $File::Find::name if /^\.env(\..+)?$|\.env$|^ecosystem.*\.(c?js|json)$/;
  }, $root);
  @files = sort @files;
} else {
  @files = @ARGV;
}

my $changed = 0;
for my $f (@files) {
  next unless -f $f;
  if ($mode eq 'restore') {
    next unless -f "$f$BACKUP";
    my $perm = (stat $f)[2] & 07777;
    copy("$f$BACKUP", "$f.frankfurt-tmp-$$") or die "Nie mogę skopiować $f$BACKUP: $!\n";
    chmod($perm, "$f.frankfurt-tmp-$$");
    rename("$f.frankfurt-tmp-$$", $f) or die "Nie mogę przywrócić $f: $!\n";
    print "  przywrócono: $f\n";
    $changed++;
    next;
  }
  open(my $in, '<:raw', $f) or do { print "  $f: nie mogę odczytać ($!)\n"; next };
  my $orig = do { local $/; <$in> };
  close $in;
  my $s = $orig;
  my ($url, $ka, $ks, $other) = (0, 0, 0, 0);
  # Bez db.<stary>.supabase.co — bezpośredni adres bazy ma inne hasło; zostaje na liście „ZOSTAŁ”.
  $url = ($s =~ s/(?<!db\.)\b\Q$OLD\E(?=\.supabase\.co)/$NEW/g) || 0 if $NEW;
  $s =~ s{($JWT)}{
    my $t = $1;
    my $role = old_jwt_role($t);
    if (!defined $role) { $t }
    elsif ($role eq 'anon') { $ka++; $anon ne '' ? $anon : $t }
    elsif ($role eq 'service_role') { $ks++; $service ne '' ? $service : $t }
    else { $other++; $t }
  }ge;
  # Co zostało ze starego projektu (np. adres bazy z hasłem) — tylko nazwy zmiennych, bez wartości.
  my %left;
  for my $line (split /\n/, $s) {
    my $hit = $line =~ /\Q$OLD\E/;
    if (!$hit) { for my $t ($line =~ /($JWT)/g) { $hit = 1 if defined old_jwt_role($t); } }
    next unless $hit;
    my ($name) = $line =~ /^\s*(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*[=:]/;
    $left{$name // '(linia bez nazwy)'} = 1;
  }
  my $sb = () = $s =~ /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g;
  my @info;
  push @info, "adres ×$url" if $url;
  push @info, "klucz anon ×$ka" if $ka;
  push @info, "klucz service_role ×$ks" if $ks;
  push @info, 'bez zmian' unless @info;
  push @info, 'ZOSTAŁ stary projekt: ' . join(', ', sort keys %left) if %left;
  push @info, "klucze sb_… ×$sb (nie wiadomo, z którego projektu — sprawdź ręcznie)" if $sb;
  print "  $f: ", join('; ', @info), "\n";
  next if $s eq $orig || $mode eq 'dry';
  my $perm = (stat $f)[2] & 07777;
  unless (-e "$f$BACKUP") {
    copy($f, "$f$BACKUP") or die "Nie mogę zrobić kopii $f: $!\n";
    chmod(0600, "$f$BACKUP");
  }
  my $tmp = "$f.frankfurt-tmp-$$";
  open(my $out, '>:raw', $tmp) or die "Nie mogę zapisać $tmp: $!\n";
  print $out $s;
  close($out) or die "Nie mogę zapisać $tmp: $!\n";
  chmod($perm, $tmp);
  rename($tmp, $f) or die "Nie mogę podmienić $f: $!\n";
  $changed++;
}
print $mode eq 'restore' ? "  — przywrócono plików: $changed\n" : "  — zmieniono plików: $changed\n" unless $mode eq 'dry';
